from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from main import create_app


class RelayTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.token = "test-only-token-" * 3
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.enterContext(patch.dict("os.environ", {
            "THERMIQ_RELAY_TOKEN": self.token,
            "THERMIQ_RELAY_DB": str(Path(directory) / "relay.sqlite3"),
        }))
        self.client = await self.enterAsyncContext(self.client_for("ble_simulator"))
        self.payload = {
            "sample_id": str(uuid4()),
            "probe_id": "probe-1",
            "measured_at": datetime.now(UTC).isoformat(),
            "simulated": True,
            "values": {"food_temperature": 60, "battery_percent": 85},
        }

    def client_for(self, mode):
        return AsyncClient(transport=ASGITransport(app=create_app(mode)), base_url="http://test")

    async def post(self, payload=None):
        return await self.client.post(
            "/api/v1/relay/readings", json=payload or self.payload, headers=self.headers,
        )

    async def test_authentication_and_empty_feed(self):
        response = await self.client.post("/api/v1/relay/readings", json=self.payload)
        self.assertEqual(response.status_code, 401)
        self.assertEqual((await self.client.get("/api/v1/telemetry")).status_code, 503)

    async def test_ingestion_persists_and_retries_are_idempotent(self):
        self.assertEqual((await self.post()).json(), {"stored": True})
        self.assertEqual((await self.post()).json(), {"stored": False})
        changed = {**self.payload, "values": {"food_temperature": 70}}
        self.assertEqual((await self.post(changed)).status_code, 409)
        async with self.client_for("ble_simulator") as restarted:
            snapshot = (await restarted.get("/api/v1/telemetry")).json()
        self.assertEqual(snapshot["source"], "simulator")
        readings = {reading["sensor_type"]: reading for reading in snapshot["readings"]}
        self.assertEqual(readings["food_core"]["temperature_c"], 60)
        self.assertEqual(readings["battery"]["battery_percent"], 85)
        self.assertIsNone(readings["battery"]["temperature_c"])
        self.assertTrue(all(reading["simulated"] for reading in readings.values()))

    async def test_partial_samples_preserve_channels_and_late_samples_do_not_replace_newer_values(self):
        await self.post()
        old = (datetime.now(UTC) - timedelta(minutes=2)).isoformat()
        await self.post({
            **self.payload, "sample_id": str(uuid4()), "measured_at": old,
            "values": {"food_temperature": 50, "ambient_temperature": 120, "probe_tip_4_temperature": None},
        })
        snapshot = (await self.client.get("/api/v1/telemetry")).json()
        readings = {reading["sensor_type"]: reading for reading in snapshot["readings"]}
        self.assertEqual(readings["food_core"]["temperature_c"], 60)
        self.assertEqual(readings["ambient"]["quality"], "stale")
        self.assertEqual(readings["internal_shaft"]["quality"], "missing")
        self.assertEqual(readings["internal_shaft"]["sensor_index"], 3)

    async def test_rejects_invalid_payloads_and_mixed_provenance(self):
        for change in (
            {"simulated": False},
            {"measured_at": "2026-01-01T12:00:00"},
            {"measured_at": (datetime.now(UTC) + timedelta(minutes=1)).isoformat()},
            {"values": {"food_temperature": 3276.7}},
            {"values": {"battery_percent": 101}},
            {"values": {}},
        ):
            self.assertEqual((await self.post({**self.payload, **change})).status_code, 422)

    async def test_live_and_simulated_feeds_are_separate(self):
        await self.post()
        async with self.client_for("ble") as live:
            self.assertEqual((await live.get("/api/v1/telemetry")).status_code, 503)
            response = await live.post(
                "/api/v1/relay/readings",
                json={**self.payload, "sample_id": str(uuid4()), "simulated": False},
                headers=self.headers,
            )
            self.assertEqual(response.json(), {"stored": True})
            snapshot = (await live.get("/api/v1/telemetry")).json()
        self.assertEqual(snapshot["source"], "ble")
        self.assertFalse(snapshot["readings"][0]["simulated"])

    async def test_telemetry_history_filters_window_and_downsamples(self):
        now = datetime.now(UTC)
        old = (now - timedelta(minutes=25)).isoformat()
        recent_one = (now - timedelta(minutes=8)).isoformat()
        recent_two = (now - timedelta(minutes=2)).isoformat()
        for measured_at, temp in ((old, 40.0), (recent_one, 55.0), (recent_two, 61.5)):
            self.assertEqual((await self.post({
                "sample_id": str(uuid4()), "probe_id": "probe-1", "measured_at": measured_at,
                "simulated": True, "values": {"food_temperature": temp, "ambient_temperature": temp + 50},
            })).status_code, 200)

        # Only samples inside the requested 10-minute window appear; 25m-old sample is ignored.
        ten_min = (await self.client.get("/api/v1/telemetry/history?window_seconds=600")).json()
        self.assertEqual(len(ten_min["snapshots"]), 2)
        temps = [
            next(r["temperature_c"] for r in snap["readings"] if r["sensor_type"] == "food_core")
            for snap in ten_min["snapshots"]
        ]
        self.assertEqual(temps, [55.0, 61.5])

        # Widening to 1 hour includes the 25m-old sample; 5 minutes keeps only the 2m-old sample.
        one_hour = (await self.client.get("/api/v1/telemetry/history?window_seconds=3600")).json()
        self.assertEqual(len(one_hour["snapshots"]), 3)
        five_min = (await self.client.get("/api/v1/telemetry/history?window_seconds=300")).json()
        self.assertEqual(len(five_min["snapshots"]), 1)

        # Live ble feed remains isolated from ble_simulator history.
        async with self.client_for("ble") as live:
            empty = (await live.get("/api/v1/telemetry/history?window_seconds=3600")).json()
            self.assertEqual(empty["snapshots"], [])
