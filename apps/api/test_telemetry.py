from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase

from httpx import ASGITransport, AsyncClient

from main import create_app
from simulator import simulate_snapshot


class TelemetryTests(IsolatedAsyncioTestCase):
    async def test_simulator_contract(self):
        async with AsyncClient(
            transport=ASGITransport(app=create_app("simulator")), base_url="http://test"
        ) as client:
            response = await client.get("/api/v1/telemetry")
        self.assertEqual(response.status_code, 200)
        snapshot = response.json()
        self.assertEqual(snapshot["source"], "simulator")
        self.assertEqual(snapshot["device_id"], "simulated-cq60")
        self.assertEqual(datetime.fromisoformat(snapshot["observed_at"]).utcoffset(), timedelta(0))
        self.assertEqual(
            [probe["id"] for probe in snapshot["probes"]],
            [f"sim-probe-{number}" for number in range(1, 5)],
        )
        self.assertEqual(len(snapshot["readings"]), 12)
        self.assertEqual(len({reading["sensor_id"] for reading in snapshot["readings"]}), 12)
        for reading in snapshot["readings"]:
            self.assertEqual(reading["quality"], "valid")
            self.assertTrue(reading["simulated"])
            self.assertIsInstance(reading["temperature_c"], float)

    def test_simulator_changes_with_time(self):
        observed_at = datetime(2026, 1, 1, tzinfo=UTC)
        first = simulate_snapshot(observed_at)
        later = simulate_snapshot(observed_at + timedelta(seconds=30))
        self.assertEqual(first, simulate_snapshot(observed_at))
        self.assertNotEqual(
            [reading.temperature_c for reading in first.readings],
            [reading.temperature_c for reading in later.readings],
        )

    def test_invalid_mode_fails_at_startup(self):
        with self.assertRaises(ValueError):
            create_app("unknown")

    def test_hot_right_creates_persistent_ambient_gradient(self):
        start = datetime(2026, 1, 1, tzinfo=UTC)
        for elapsed in (0, 30, 300):
            snapshot = simulate_snapshot(start + timedelta(seconds=elapsed), "hot-right")
            readings = [reading.temperature_c for reading in snapshot.readings if reading.sensor_type == "ambient"]
            self.assertAlmostEqual(readings[-1] - readings[0], 15)

    def test_removed_probe_recovers_with_stable_channel_ids(self):
        start = datetime(2026, 1, 1, tzinfo=UTC)
        removed = simulate_snapshot(start + timedelta(seconds=50), "probe-removal")
        recovered = simulate_snapshot(start + timedelta(seconds=60), "probe-removal")
        missing = [reading for reading in removed.readings if reading.quality == "missing"]
        self.assertEqual(len(missing), 3)
        self.assertTrue(all(reading.probe_id == "sim-probe-4" for reading in missing))
        self.assertTrue(all(reading.temperature_c is None for reading in missing))
        self.assertEqual(
            [reading.sensor_id for reading in removed.readings],
            [reading.sensor_id for reading in recovered.readings],
        )
        self.assertTrue(all(reading.quality == "valid" for reading in recovered.readings))
