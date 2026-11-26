from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from main import create_app


class ProbePreferencesTests(IsolatedAsyncioTestCase):
    async def test_rename_reorder_validation_and_persistence(self):
        directory = self.enterContext(TemporaryDirectory())
        token = "test-only-token-" * 3
        headers = {"Authorization": f"Bearer {token}"}
        self.enterContext(patch.dict("os.environ", {
            "THERMIQ_SESSION_DB": str(Path(directory) / "sessions.sqlite3"),
            "THERMIQ_RELAY_DB": str(Path(directory) / "relay.sqlite3"),
            "THERMIQ_RELAY_TOKEN": token,
        }))

        app = create_app("ble")
        async with app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            self.assertEqual((await client.get("/api/v1/probes")).json(), [])
            now = datetime.now(UTC).isoformat()
            for probe_id in ("aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:03", "aa:bb:cc:dd:ee:02"):
                self.assertEqual((await client.post("/api/v1/relay/readings", headers=headers, json={
                    "sample_id": str(uuid4()), "probe_id": probe_id, "measured_at": now,
                    "simulated": False, "values": {"food_temperature": 60.0},
                })).status_code, 200)

            duplicate = [
                {"probe_id": "aa:bb:cc:dd:ee:01", "name": "Probe 1"},
                {"probe_id": "aa:bb:cc:dd:ee:01", "name": "Probe 2"},
            ]
            self.assertEqual((await client.put("/api/v1/probes", json=duplicate)).status_code, 422)
            self.assertEqual(
                (await client.put("/api/v1/probes", json=[{"probe_id": "aa:bb:cc:dd:ee:01", "name": "   "}])).status_code,
                422,
            )

            desired = [
                {"probe_id": "aa:bb:cc:dd:ee:01", "name": "Probe 1"},
                {"probe_id": "aa:bb:cc:dd:ee:02", "name": "Probe 2"},
                {"probe_id": "aa:bb:cc:dd:ee:03", "name": "Probe 3"},
            ]
            saved = await client.put("/api/v1/probes", json=desired)
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json(), [
                {"probe_id": "aa:bb:cc:dd:ee:01", "name": "Probe 1", "sort_order": 0},
                {"probe_id": "aa:bb:cc:dd:ee:02", "name": "Probe 2", "sort_order": 1},
                {"probe_id": "aa:bb:cc:dd:ee:03", "name": "Probe 3", "sort_order": 2},
            ])

            # Add an unconfigured fourth probe and verify it follows the ordered ones.
            await client.post("/api/v1/relay/readings", headers=headers, json={
                "sample_id": str(uuid4()), "probe_id": "00:11:22:33:44:55", "measured_at": now,
                "simulated": False, "values": {"food_temperature": 55.0},
            })

        restarted = create_app("ble")
        async with restarted.router.lifespan_context(restarted), AsyncClient(
            transport=ASGITransport(app=restarted), base_url="http://test"
        ) as client:
            snapshot = (await client.get("/api/v1/telemetry")).json()
            self.assertEqual(snapshot["probes"], [
                {"id": "aa:bb:cc:dd:ee:01", "name": "Probe 1"},
                {"id": "aa:bb:cc:dd:ee:02", "name": "Probe 2"},
                {"id": "aa:bb:cc:dd:ee:03", "name": "Probe 3"},
                {"id": "00:11:22:33:44:55", "name": "00:11:22:33:44:55"},
            ])
            # Stable reading probe_id values remain untouched.
            self.assertEqual(
                {reading["probe_id"] for reading in snapshot["readings"]},
                {"aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:02", "aa:bb:cc:dd:ee:03", "00:11:22:33:44:55"},
            )
