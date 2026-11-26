from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, FiniteFloat

Source = Literal["simulator", "ble"]
SensorType = Literal["food_core", "internal_shaft", "ambient", "battery", "device_diagnostic", "unknown"]


class Probe(BaseModel):
    id: str
    name: str


class SensorReading(BaseModel):
    device_id: str
    probe_id: str
    sensor_id: str
    sensor_type: SensorType
    sensor_index: int | None = None
    temperature_c: FiniteFloat | None = None
    battery_percent: FiniteFloat | None = None
    measured_at: AwareDatetime
    received_at: AwareDatetime
    source: Source
    quality: Literal["valid", "missing", "invalid", "stale", "unsupported"]
    simulated: bool


class TelemetrySnapshot(BaseModel):
    source: Source
    device_id: str
    observed_at: AwareDatetime
    probes: list[Probe]
    readings: list[SensorReading]
