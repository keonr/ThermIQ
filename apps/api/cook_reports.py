import csv
import io
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import sqrt
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from equipment import EquipmentProfile
from sessions import SESSION_QUERY, session_from_row
from telemetry import TelemetrySnapshot


@dataclass
class Stats:
    count: int = 0
    mean: float = 0
    m2: float = 0
    low: float = float("inf")
    high: float = float("-inf")

    def add(self, value: float):
        self.count += 1
        difference = value - self.mean
        self.mean += difference / self.count
        self.m2 += difference * (value - self.mean)
        self.low = min(self.low, value)
        self.high = max(self.high, value)

    def report(self) -> dict:
        return {"count": self.count, "mean_c": self.mean, "min_c": self.low,
                "max_c": self.high, "stddev_c": sqrt(max(0, self.m2) / self.count)}


class CalibrationInput(BaseModel):
    session_id: UUID
    setpoint_c: float = Field(ge=30, le=400)
    minutes: float = Field(ge=0.1, le=720)
    chamber_load: Literal["empty", "loaded"]


def stamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds")


def cook_reports_router(path: str) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def get_finished(db, session_id):
        db.row_factory = sqlite3.Row
        row = db.execute(SESSION_QUERY + " WHERE cook_sessions.id = ?", (str(session_id),)).fetchone()
        if row is None:
            raise HTTPException(404, "Cook session not found")
        session = session_from_row(row)
        if session.ended_at is None:
            raise HTTPException(409, "Finish the cook before generating a report")
        return session

    @router.get("/sessions/{session_id}/summary")
    def summary(session_id: UUID):
        with closing(sqlite3.connect(path)) as db:
            session = get_finished(db, session_id)
            total = db.execute("SELECT count(*) FROM cook_snapshots WHERE session_id = ?", (str(session_id),)).fetchone()[0]
            step = max(1, (total + 238) // 239)
            ambient = Stats()
            latest_ambient = {}
            core = {}
            frames = []
            for index, (payload,) in enumerate(db.execute("""
                SELECT payload FROM cook_snapshots WHERE session_id = ? ORDER BY observed_at
            """, (str(session_id),))):
                snapshot = TelemetrySnapshot.model_validate_json(payload)
                readings = {"food_core": {}, "ambient": {}}
                for reading in snapshot.readings:
                    value = reading.temperature_c
                    if value is None or reading.quality != "valid":
                        continue
                    if reading.sensor_type == "ambient":
                        previous = latest_ambient.get(reading.sensor_id)
                        if previous is None or reading.measured_at > previous:
                            ambient.add(value)
                            latest_ambient[reading.sensor_id] = reading.measured_at
                    elif reading.sensor_type == "food_core":
                        core[reading.probe_id] = value
                    if reading.sensor_type in readings:
                        readings[reading.sensor_type][reading.probe_id] = value
                if index % step == 0 or index + 1 == total:
                    frames.append({
                        "elapsed_s": (snapshot.observed_at - session.started_at).total_seconds(),
                        "food_core": readings["food_core"], "ambient": readings["ambient"],
                    })
        return {
            "duration_s": (session.ended_at - session.started_at).total_seconds(),
            "sample_count": total, "ambient": ambient.report() if ambient.count else None,
            "final_core_c": core, "frames": frames,
        }

    @router.get("/sessions/{session_id}/export")
    def export(session_id: UUID, format: Literal["csv", "json"] = "csv"):
        with closing(sqlite3.connect(path)) as db:
            session = get_finished(db, session_id)

        def rows():
            after = 0
            while True:
                with closing(sqlite3.connect(path)) as db:
                    batch = db.execute("""
                        SELECT id, payload FROM cook_snapshots WHERE session_id = ? AND id > ?
                        ORDER BY id LIMIT 256
                    """, (str(session_id), after)).fetchall()
                if not batch:
                    return
                after = batch[-1][0]
                yield from batch

        def json_data():
            yield '{"session":'
            yield session.model_dump_json()
            yield ',"snapshots":['
            for index, (_, payload) in enumerate(rows()):
                if index:
                    yield ','
                yield payload
            yield ']}'

        def csv_data():
            stream = io.StringIO()
            writer = csv.writer(stream)
            writer.writerow([
                "observed_at", "measured_at", "received_at", "probe_id", "sensor_id",
                "sensor_type", "temperature_c", "battery_percent", "source", "quality", "simulated",
            ])
            yield stream.getvalue()
            for _, payload in rows():
                stream.seek(0)
                stream.truncate()
                snapshot = TelemetrySnapshot.model_validate_json(payload)
                for reading in snapshot.readings:
                    writer.writerow([
                        snapshot.observed_at.isoformat(), reading.measured_at.isoformat(),
                        reading.received_at.isoformat(), reading.probe_id, reading.sensor_id,
                        reading.sensor_type, reading.temperature_c, reading.battery_percent,
                        reading.source, reading.quality, reading.simulated,
                    ])
                yield stream.getvalue()

        return StreamingResponse(
            csv_data() if format == "csv" else json_data(),
            media_type="text/csv" if format == "csv" else "application/json",
            headers={"Content-Disposition": f'attachment; filename="thermiq-{session_id}.{format}"'},
        )

    @router.get("/calibrations")
    def calibrations():
        with closing(sqlite3.connect(path)) as db:
            return [CalibrationReport.model_validate_json(row[0]) for row in db.execute(
                "SELECT payload FROM cook_calibrations ORDER BY rowid DESC"
            )]

    @router.post("/calibrations", status_code=201)
    def calibrate(request: CalibrationInput):
        with closing(sqlite3.connect(path)) as db, db:
            session = get_finished(db, request.session_id)
            start = session.ended_at - timedelta(minutes=request.minutes)
            if start < session.started_at:
                raise HTTPException(422, "The sampling window is longer than the cook")
            if session.equipment is None:
                raise HTTPException(422, "Calibration requires a cook with an equipment layout")
            revision = db.execute("""
                SELECT payload FROM cook_placement_events WHERE session_id = ? AND recorded_at <= ?
                ORDER BY revision DESC LIMIT 1
            """, (session.id, stamp(start))).fetchone()
            layout = EquipmentProfile.model_validate_json(revision[0]) if revision else session.equipment
            if db.execute("""
                SELECT 1 FROM cook_placement_events WHERE session_id = ? AND recorded_at > ? LIMIT 1
            """, (session.id, stamp(start))).fetchone():
                raise HTTPException(422, "Probe positions must remain fixed in the sampling window")
            if not layout.probes:
                raise HTTPException(422, "Place probes in the chamber before sampling")
            locations = {probe.probe_id: Stats() for probe in layout.probes}
            last_measured = {}
            sources = set()
            for (payload,) in db.execute("""
                SELECT payload FROM cook_snapshots WHERE session_id = ? AND observed_at >= ? AND observed_at <= ?
                ORDER BY observed_at
            """, (session.id, stamp(start), stamp(session.ended_at))):
                snapshot = TelemetrySnapshot.model_validate_json(payload)
                sources.add(snapshot.source)
                for reading in snapshot.readings:
                    if (reading.sensor_type != "ambient" or reading.quality != "valid"
                            or reading.temperature_c is None or reading.probe_id not in locations
                            or not start <= reading.measured_at <= session.ended_at):
                        continue
                    previous = last_measured.get(reading.sensor_id)
                    if previous is None or reading.measured_at > previous:
                        locations[reading.probe_id].add(reading.temperature_c)
                        last_measured[reading.sensor_id] = reading.measured_at
            measured = [
                {"probe_id": probe.probe_id, "x_mm": probe.x_mm, "y_mm": probe.y_mm,
                 "deviation_c": locations[probe.probe_id].mean - request.setpoint_c,
                 **locations[probe.probe_id].report()}
                for probe in layout.probes if locations[probe.probe_id].count >= 2
            ]
            if not measured:
                raise HTTPException(422, "Need at least two valid ambient samples at a placed probe")
            report = CalibrationReport(
                id=str(uuid4()), session_id=str(request.session_id), equipment_id=str(layout.id),
                equipment_name=layout.name, setpoint_c=request.setpoint_c, chamber_load=request.chamber_load,
                started_at=start, ended_at=session.ended_at, simulated=sources == {"simulator"},
                locations=measured, placed_count=len(layout.probes), layout=layout,
            )
            db.execute("INSERT INTO cook_calibrations VALUES (?, ?)", (report.id, report.model_dump_json()))
        return report

    return router


class CalibrationLocation(BaseModel):
    probe_id: str
    x_mm: float
    y_mm: float
    deviation_c: float
    count: int
    mean_c: float
    min_c: float
    max_c: float
    stddev_c: float


class CalibrationReport(BaseModel):
    id: str
    session_id: str
    equipment_id: str
    equipment_name: str
    setpoint_c: float
    chamber_load: str
    started_at: datetime
    ended_at: datetime
    simulated: bool
    placed_count: int
    locations: list[CalibrationLocation]
    layout: EquipmentProfile | None = None
