import sqlite3
from contextlib import closing
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints

from telemetry import TelemetrySnapshot

ProbeText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ProbePreference(BaseModel):
    probe_id: ProbeText
    name: ProbeText
    sort_order: int = Field(default=0, ge=0, le=1000)


class ProbeStore:
    def __init__(self, path: str):
        self.path = path

    def initialize(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS probe_preferences (
                    probe_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    sort_order INTEGER NOT NULL
                )
            """)

    def list_preferences(self) -> list[ProbePreference]:
        with closing(sqlite3.connect(self.path)) as db:
            exists = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'probe_preferences'"
            ).fetchone()
            if not exists:
                return []
            return [
                ProbePreference(probe_id=probe_id, name=name, sort_order=sort_order)
                for probe_id, name, sort_order in db.execute(
                    "SELECT probe_id, name, sort_order FROM probe_preferences ORDER BY sort_order ASC, probe_id ASC"
                )
            ]

    def replace(self, items: list[ProbePreference]) -> list[ProbePreference]:
        if len({item.probe_id for item in items}) != len(items):
            raise HTTPException(422, "Probe identifiers must be unique")
        ordered = [
            ProbePreference(probe_id=item.probe_id, name=item.name, sort_order=index)
            for index, item in enumerate(items)
        ]
        self.initialize()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("DELETE FROM probe_preferences")
            db.executemany(
                "INSERT INTO probe_preferences(probe_id, name, sort_order) VALUES (?, ?, ?)",
                [(item.probe_id, item.name, item.sort_order) for item in ordered],
            )
        return ordered

    def apply(self, snapshot: TelemetrySnapshot) -> TelemetrySnapshot:
        preferences = self.list_preferences()
        if not preferences:
            return snapshot
        by_id = {item.probe_id: item for item in preferences}
        fallback_rank = len(preferences)
        ordered = [
            probe.model_copy(update={"name": by_id[probe.id].name}) if probe.id in by_id else probe
            for _, probe in sorted(
                enumerate(snapshot.probes),
                key=lambda entry: (
                    by_id[entry[1].id].sort_order if entry[1].id in by_id else fallback_rank,
                    entry[0],
                ),
            )
        ]
        return snapshot.model_copy(update={"probes": ordered})


def probes_router(store: ProbeStore) -> APIRouter:
    router = APIRouter(prefix="/api/v1/probes", tags=["probes"])

    @router.get("")
    def list_probes() -> list[ProbePreference]:
        return store.list_preferences()

    @router.put("")
    def save_probes(items: Annotated[list[ProbePreference], Field(max_length=32)]) -> list[ProbePreference]:
        return store.replace(items)

    return router
