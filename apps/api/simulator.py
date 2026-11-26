from datetime import datetime
from math import sin
from typing import Literal

from pydantic import TypeAdapter

from telemetry import Probe, SensorReading, SensorType, TelemetrySnapshot

Scenario = Literal["uniform", "hot-right", "probe-removal"]
scenario_adapter = TypeAdapter(Scenario)


def simulate_snapshot(observed_at: datetime, scenario: Scenario = "uniform") -> TelemetrySnapshot:
    device_id = "simulated-cq60"
    elapsed = observed_at.timestamp()
    phase = elapsed / 30
    probes = []
    readings = []
    for number in range(1, 5):
        probe = Probe(id=f"sim-probe-{number}", name=f"Probe {number}")
        probes.append(probe)
        core = 50 + number * 4 + sin(phase + number) * 3
        ambient = 121 + sin(phase / 2) * 2
        if scenario == "hot-right":
            ambient += (number - 1) * 5
        missing = scenario == "probe-removal" and number == 4 and elapsed % 60 >= 45
        channels: list[tuple[SensorType, int | None, float]] = [
            ("food_core", None, core),
            ("ambient", None, ambient),
            ("internal_shaft", 0, core + 2),
        ]
        readings.extend(
            SensorReading(
                device_id=device_id,
                probe_id=probe.id,
                sensor_id=f"{probe.id}-{kind}-{index if index is not None else 'primary'}",
                sensor_type=kind,
                sensor_index=index,
                temperature_c=None if missing else round(value, 1),
                measured_at=observed_at,
                received_at=observed_at,
                source="simulator",
                quality="missing" if missing else "valid",
                simulated=True,
            )
            for kind, index, value in channels
        )
    return TelemetrySnapshot(
        source="simulator",
        device_id=device_id,
        observed_at=observed_at,
        probes=probes,
        readings=readings,
    )
