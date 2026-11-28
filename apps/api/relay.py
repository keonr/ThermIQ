import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from providers import ProviderUnavailable
from telemetry import Probe, SensorReading, TelemetrySnapshot

Temperature = Annotated[float, Field(strict=True, ge=-100, le=1000)]
Battery = Annotated[float, Field(strict=True, ge=0, le=100)]
CHANNELS = {
    "food_temperature": ("food_core", None),
    "ambient_temperature": ("ambient", None),
    **{f"probe_tip_{i}_temperature": ("internal_shaft", i - 1) for i in range(1, 5)},
    "battery_percent": ("battery", None),
    "soc_temperature": ("device_diagnostic", None),
}


class RelayValues(BaseModel):
    model_config = ConfigDict(extra="forbid")
    food_temperature: Temperature | None = None
    ambient_temperature: Temperature | None = None
    probe_tip_1_temperature: Temperature | None = None
    probe_tip_2_temperature: Temperature | None = None
    probe_tip_3_temperature: Temperature | None = None
    probe_tip_4_temperature: Temperature | None = None
    battery_percent: Battery | None = None
    soc_temperature: Temperature | None = None

    @model_validator(mode="after")
    def require_channel(self):
        if not self.model_fields_set:
            raise ValueError("At least one channel is required")
        return self


class RelaySample(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sample_id: UUID
    probe_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")]
    measured_at: AwareDatetime
    simulated: bool = False
    values: RelayValues


class RelayHistory(BaseModel):
    snapshots: list[TelemetrySnapshot]
    bucket_seconds: int
    window_seconds: int


class SampleConflict(Exception):
    """A retry changed an already stored sample."""


class RelayStore:
    def __init__(self, path: str, simulated: bool):
        self.path = path
        self.simulated = simulated
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS relay_samples (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS relay_values (
                    sample_id TEXT NOT NULL,
                    simulated INTEGER NOT NULL,
                    probe_id TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    measured_at TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    value REAL,
                    PRIMARY KEY (sample_id, channel),
                    FOREIGN KEY (sample_id) REFERENCES relay_samples(id)
                );
                CREATE INDEX IF NOT EXISTS relay_latest
                    ON relay_values(simulated, probe_id, channel, measured_at DESC);
            """)

    def record(self, sample: RelaySample, received_at: datetime) -> bool:
        fields = sample.values.model_dump(exclude_unset=True)
        measured_at = sample.measured_at.astimezone(UTC)
        sample_id = str(sample.sample_id)
        payload = json.dumps(
            {**sample.model_dump(mode="json", exclude={"values", "measured_at"}),
             "measured_at": measured_at.isoformat(), "values": fields},
            sort_keys=True,
        )
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("PRAGMA foreign_keys = ON")
            result = db.execute(
                "INSERT INTO relay_samples VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
                (sample_id, payload),
            )
            if not result.rowcount:
                existing, = db.execute("SELECT payload FROM relay_samples WHERE id = ?", (sample_id,)).fetchone()
                if existing != payload:
                    raise SampleConflict
                return False
            db.executemany(
                "INSERT INTO relay_values VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (sample_id, sample.simulated, sample.probe_id, channel,
                     measured_at.isoformat(timespec="microseconds"),
                     received_at.isoformat(timespec="microseconds"), value)
                    for channel, value in fields.items()
                ],
            )
        return True

    def latest_snapshot(self) -> TelemetrySnapshot:
        now = datetime.now(UTC)
        with closing(sqlite3.connect(self.path)) as db:
            rows = db.execute("""
                SELECT probe_id, channel, measured_at, received_at, value FROM (
                    SELECT *, row_number() OVER (
                        PARTITION BY probe_id, channel
                        ORDER BY measured_at DESC, received_at DESC, sample_id DESC
                    ) AS position
                    FROM relay_values WHERE simulated = ?
                ) WHERE position = 1 ORDER BY probe_id, channel
            """, (self.simulated,)).fetchall()
        if not rows:
            raise ProviderUnavailable("Waiting for BLE relay readings.")
        device = "simulated-relay" if self.simulated else "ble-relay"
        source = "simulator" if self.simulated else "ble"
        probes = {}
        readings = []
        for probe_id, channel, measured, received, value in rows:
            probes[probe_id] = Probe(id=probe_id, name=probe_id)
            kind, index = CHANNELS[channel]
            measured_at = datetime.fromisoformat(measured)
            quality = "missing" if value is None else "valid"
            if value is not None and now - measured_at > timedelta(seconds=30):
                quality = "stale"
            readings.append(SensorReading(
                device_id=device, probe_id=probe_id, sensor_id=f"{probe_id}/{channel}",
                sensor_type=kind, sensor_index=index,
                temperature_c=value if kind != "battery" else None,
                battery_percent=value if kind == "battery" else None,
                measured_at=measured_at, received_at=datetime.fromisoformat(received),
                source=source, quality=quality, simulated=self.simulated,
            ))
        return TelemetrySnapshot(
            source=source, device_id=device, probes=list(probes.values()),
            readings=readings, observed_at=max(reading.measured_at for reading in readings),
        )

    def history(self, window_seconds: int, max_points: int = 450) -> RelayHistory:
        now = datetime.now(UTC)
        cutoff = now - timedelta(seconds=window_seconds)
        bucket_seconds = max(2, (window_seconds + max_points - 1) // max_points)
        with closing(sqlite3.connect(self.path)) as db:
            rows = db.execute("""
                SELECT probe_id, channel, measured_at, received_at, value
                FROM relay_values
                WHERE simulated = ?
                  AND channel IN ('food_temperature', 'ambient_temperature')
                  AND value IS NOT NULL
                  AND measured_at >= ?
                ORDER BY measured_at ASC, received_at ASC, sample_id ASC
            """, (self.simulated, cutoff.isoformat(timespec="microseconds"))).fetchall()

        buckets: dict[int, dict[tuple[str, str], tuple[datetime, datetime, float]]] = {}
        known_probes: dict[str, Probe] = {}
        for probe_id, channel, measured, received, value in rows:
            measured_at = datetime.fromisoformat(measured)
            if measured_at < cutoff or measured_at > now:
                continue
            known_probes.setdefault(probe_id, Probe(id=probe_id, name=probe_id))
            bucket_id = int(measured_at.timestamp() // bucket_seconds)
            buckets.setdefault(bucket_id, {})[(probe_id, channel)] = (
                measured_at, datetime.fromisoformat(received), float(value),
            )

        device = "simulated-relay" if self.simulated else "ble-relay"
        source = "simulator" if self.simulated else "ble"
        probe_list = sorted(known_probes.values(), key=lambda probe: probe.id)
        snapshots: list[TelemetrySnapshot] = []
        for bucket_id in sorted(buckets):
            entries = buckets[bucket_id]
            readings = []
            for (probe_id, channel), (measured_at, received_at, value) in sorted(entries.items()):
                kind, index = CHANNELS[channel]
                readings.append(SensorReading(
                    device_id=device, probe_id=probe_id, sensor_id=f"{probe_id}/{channel}",
                    sensor_type=kind, sensor_index=index, temperature_c=value,
                    battery_percent=None, measured_at=measured_at, received_at=received_at,
                    source=source, quality="valid", simulated=self.simulated,
                ))
            snapshots.append(TelemetrySnapshot(
                source=source, device_id=device, probes=probe_list, readings=readings,
                observed_at=max(reading.measured_at for reading in readings),
            ))
        return RelayHistory(snapshots=snapshots, bucket_seconds=bucket_seconds, window_seconds=window_seconds)
