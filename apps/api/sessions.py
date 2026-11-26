import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from equipment import EquipmentProfile, Food, Layout, ProbePlacement
from telemetry import TelemetrySnapshot


class SessionInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    equipment_id: UUID | None = None


class CookSession(BaseModel):
    id: str
    name: str
    started_at: datetime
    ended_at: datetime | None
    equipment: EquipmentProfile | None = None
    capture_mode: str = "simulator"


class PlacementChanges(BaseModel):
    revision: int = Field(ge=0)
    food: list[Food] = Field(max_length=32)
    probes: list[ProbePlacement] = Field(max_length=32)


class PlacementEvent(BaseModel):
    revision: int
    recorded_at: datetime
    layout: EquipmentProfile


class PlacementConflict(Exception):
    pass


class SessionNotFound(Exception):
    pass


class ActiveSessionExists(Exception):
    pass


class EquipmentNotFound(Exception):
    pass


def session_from_row(row: sqlite3.Row) -> CookSession:
    data = dict(row)
    payload = data.get("equipment")
    data["equipment"] = EquipmentProfile.model_validate_json(payload) if payload else None
    return CookSession.model_validate(data)


SESSION_QUERY = """
    SELECT cook_sessions.*, cook_equipment.payload AS equipment,
           coalesce(cook_sources.mode, 'simulator') AS capture_mode FROM cook_sessions
    LEFT JOIN cook_equipment ON cook_equipment.session_id = cook_sessions.id
    LEFT JOIN cook_sources ON cook_sources.session_id = cook_sessions.id
"""


class SessionStore:
    def __init__(self, path: str):
        self.path = path

    def initialize(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS cook_sessions (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT
                );
                CREATE TABLE IF NOT EXISTS cook_equipment (
                    session_id TEXT PRIMARY KEY REFERENCES cook_sessions(id),
                    payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cook_sources (
                    session_id TEXT PRIMARY KEY REFERENCES cook_sessions(id),
                    mode TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cook_calibrations (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cook_placement_events (
                    session_id TEXT NOT NULL REFERENCES cook_sessions(id),
                    revision INTEGER NOT NULL,
                    recorded_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (session_id, revision)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_cook
                    ON cook_sessions ((1)) WHERE ended_at IS NULL;
                CREATE TABLE IF NOT EXISTS cook_snapshots (
                    id INTEGER PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES cook_sessions(id),
                    observed_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    UNIQUE(session_id, observed_at)
                );
                CREATE INDEX IF NOT EXISTS cook_history ON cook_snapshots(session_id, id);
            """)

    def list_sessions(self) -> list[CookSession]:
        with closing(sqlite3.connect(self.path)) as db:
            db.row_factory = sqlite3.Row
            return [
                session_from_row(row)
                for row in db.execute(SESSION_QUERY + " ORDER BY started_at DESC")
            ]

    def start(self, name: str, equipment_id: UUID | None = None, mode: str = "simulator") -> CookSession:
        session = CookSession(id=str(uuid4()), name=name, started_at=datetime.now(UTC), ended_at=None, capture_mode=mode)
        with closing(sqlite3.connect(self.path)) as db, db:
            result = db.execute(
                "INSERT INTO cook_sessions VALUES (?, ?, ?, NULL) ON CONFLICT DO NOTHING",
                (session.id, session.name, session.started_at.isoformat(timespec="microseconds")),
            )
            if not result.rowcount:
                raise ActiveSessionExists
            db.execute("INSERT INTO cook_sources VALUES (?, ?)", (session.id, mode))
            if equipment_id is not None:
                row = db.execute(
                    "SELECT payload FROM equipment_profiles WHERE id = ?", (str(equipment_id),)
                ).fetchone()
                if row is None:
                    raise EquipmentNotFound
                session.equipment = EquipmentProfile.model_validate_json(row[0])
                db.execute("INSERT INTO cook_equipment VALUES (?, ?)", (session.id, row[0]))
        return session

    def finish(self, session_id: str) -> CookSession | None:
        with closing(sqlite3.connect(self.path)) as db, db:
            db.row_factory = sqlite3.Row
            db.execute("""
                UPDATE cook_sessions SET ended_at = coalesce(ended_at, ?) WHERE id = ?
            """, (datetime.now(UTC).isoformat(timespec="microseconds"), session_id))
            row = db.execute(SESSION_QUERY + " WHERE cook_sessions.id = ?", (session_id,)).fetchone()
        return session_from_row(row) if row else None

    def public_active_cook(self) -> dict | None:
        with closing(sqlite3.connect(self.path)) as db:
            db.row_factory = sqlite3.Row
            row = db.execute(SESSION_QUERY + " WHERE ended_at IS NULL").fetchone()
            if row is None:
                return None
            session = session_from_row(row)
            revision = db.execute("""
                SELECT recorded_at, payload FROM cook_placement_events
                WHERE session_id = ? ORDER BY revision DESC LIMIT 1
            """, (session.id,)).fetchone()
            layout = EquipmentProfile.model_validate_json(revision["payload"]) if revision else session.equipment
            return {
                "name": session.name,
                "started_at": session.started_at,
                "capture_mode": session.capture_mode,
                "layout": Layout.model_validate(layout.model_dump()) if layout else None,
                "layout_since": revision["recorded_at"] if revision else session.started_at,
            }

    def active_capture(self, mode: str) -> CookSession | None:
        with closing(sqlite3.connect(self.path)) as db:
            db.row_factory = sqlite3.Row
            row = db.execute(
                SESSION_QUERY + " WHERE ended_at IS NULL AND coalesce(cook_sources.mode, 'simulator') = ?",
                (mode,),
            ).fetchone()
        return session_from_row(row) if row else None

    def record(self, session: CookSession, snapshot: TelemetrySnapshot):
        observed_at = snapshot.observed_at.astimezone(UTC).isoformat(timespec="microseconds")
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("""
                INSERT INTO cook_snapshots (session_id, observed_at, payload)
                SELECT id, ?, ? FROM cook_sessions WHERE id = ? AND ended_at IS NULL AND started_at <= ?
                ON CONFLICT DO NOTHING
            """, (observed_at, snapshot.model_dump_json(), session.id, observed_at))

    def history(self, session_id: str, after: int, limit: int) -> dict | None:
        with closing(sqlite3.connect(self.path)) as db:
            if not db.execute("SELECT 1 FROM cook_sessions WHERE id = ?", (session_id,)).fetchone():
                return None
            rows = db.execute("""
                SELECT id, payload, observed_at FROM cook_snapshots WHERE session_id = ? AND id > ?
                ORDER BY id LIMIT ?
            """, (session_id, after, limit + 1)).fetchall()
        return {
            "snapshots": [TelemetrySnapshot.model_validate_json(payload) for _, payload, _ in rows[:limit]],
            "next_cursor": rows[limit - 1][0] if len(rows) > limit else None,
            "next_observed_at": rows[limit][2] if len(rows) > limit else None,
        }

    def placement_events(self, session_id: str) -> list[PlacementEvent]:
        with closing(sqlite3.connect(self.path)) as db:
            if not db.execute("SELECT 1 FROM cook_sessions WHERE id = ?", (session_id,)).fetchone():
                raise SessionNotFound
            return [
                PlacementEvent(revision=revision, recorded_at=recorded_at,
                               layout=EquipmentProfile.model_validate_json(payload))
                for revision, recorded_at, payload in db.execute("""
                    SELECT revision, recorded_at, payload FROM cook_placement_events
                    WHERE session_id = ? ORDER BY revision
                """, (session_id,))
            ]

    def record_placement(self, session_id: str, changes: PlacementChanges) -> PlacementEvent:
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            db.row_factory = sqlite3.Row
            row = db.execute(SESSION_QUERY + " WHERE cook_sessions.id = ?", (session_id,)).fetchone()
            if row is None:
                raise SessionNotFound
            session = session_from_row(row)
            if session.ended_at is not None or session.equipment is None:
                raise PlacementConflict("Placement changes require an active cook with equipment")
            last = db.execute("""
                SELECT revision, payload FROM cook_placement_events WHERE session_id = ?
                ORDER BY revision DESC LIMIT 1
            """, (session_id,)).fetchone()
            revision = last["revision"] if last else 0
            if changes.revision != revision:
                raise PlacementConflict("The layout changed in another tab. Reload before editing again.")
            previous = EquipmentProfile.model_validate_json(last["payload"]) if last else session.equipment
            layout = EquipmentProfile.model_validate({
                **session.equipment.model_dump(), "food": changes.food, "probes": changes.probes,
            })
            if layout == previous:
                raise PlacementConflict("Move or edit a placement before recording a change")
            recorded_at = datetime.now(UTC)
            event = PlacementEvent(revision=revision + 1, recorded_at=recorded_at, layout=layout)
            db.execute("INSERT INTO cook_placement_events VALUES (?, ?, ?, ?)", (
                session_id, event.revision, recorded_at.isoformat(timespec="microseconds"), layout.model_dump_json(),
            ))
        return event
