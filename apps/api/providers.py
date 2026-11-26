from datetime import UTC, datetime
from typing import Protocol

from simulator import Scenario, simulate_snapshot
from telemetry import TelemetrySnapshot


class ProviderUnavailable(Exception):
    """The configured provider cannot currently supply telemetry."""


class SnapshotProvider(Protocol):
    async def latest_snapshot(self) -> TelemetrySnapshot: ...


class SimulatedThermometerProvider:
    def __init__(self, scenario: Scenario):
        self.scenario = scenario

    async def latest_snapshot(self) -> TelemetrySnapshot:
        return simulate_snapshot(datetime.now(UTC), self.scenario)
