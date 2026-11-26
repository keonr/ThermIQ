import asyncio
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from main import create_app


class SessionTests(IsolatedAsyncioTestCase):
    async def test_capture_without_dashboard_polling_and_reopen_after_restart(self):
        directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict("os.environ", {
            "THERMIQ_SESSION_DB": str(Path(directory) / "sessions.sqlite3"),
        }))
        app = create_app("simulator")
        async with app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/api/v1/sessions", json={"name": " Practice brisket "})
            self.assertEqual(response.status_code, 201)
            session = response.json()
            self.assertEqual(session["name"], "Practice brisket")
            session_url = f"/api/v1/sessions/{session['id']}"
            self.assertEqual(
                (await client.post("/api/v1/sessions", json={"name": "Another cook"})).status_code,
                409,
            )
            async with asyncio.timeout(8):
                while True:
                    page = (await client.get(f"{session_url}/history?limit=1")).json()
                    if page["next_cursor"] is not None:
                        break
                    await asyncio.sleep(0.1)
            later = (await client.get(f"{session_url}/history?after={page['next_cursor']}")).json()
            self.assertTrue(later["snapshots"])
            self.assertEqual(
                datetime.fromisoformat(page["next_observed_at"]),
                datetime.fromisoformat(later["snapshots"][0]["observed_at"]),
            )
            self.assertEqual(page["snapshots"][0]["source"], "simulator")
            self.assertEqual(len(page["snapshots"][0]["probes"]), 4)
            finish = (await client.post(f"{session_url}/finish")).json()
            self.assertIsNotNone(finish["ended_at"])
            self.assertEqual((await client.post(f"{session_url}/finish")).json(), finish)

        restarted = create_app("simulator")
        async with restarted.router.lifespan_context(restarted), AsyncClient(
            transport=ASGITransport(app=restarted), base_url="http://test"
        ) as client:
            self.assertEqual((await client.get("/api/v1/sessions")).json(), [finish])
            history = (await client.get(f"{session_url}/history")).json()["snapshots"]
            self.assertEqual(history, page["snapshots"] + later["snapshots"])
            self.assertEqual((await client.get("/api/v1/sessions/unknown/history")).status_code, 404)

    async def test_session_keeps_starting_layout_after_profile_changes(self):
        directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict("os.environ", {
            "THERMIQ_SESSION_DB": str(Path(directory) / "sessions.sqlite3"),
        }))
        app = create_app("simulator")
        async with app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            layout = {"name": "Original smoker", "shape": "rectangular",
                      "width_mm": 600, "depth_mm": 400, "height_mm": 300}
            profile_response = await client.post("/api/v1/equipment", json=layout)
            self.assertEqual(profile_response.status_code, 201)
            profile = profile_response.json()
            request = {"name": "Spatial cook", "equipment_id": profile["id"]}
            missing = await client.post("/api/v1/sessions", json={**request, "equipment_id": str(uuid4())})
            self.assertEqual(missing.status_code, 404)
            self.assertEqual((await client.get("/api/v1/sessions")).json(), [])
            response = await client.post("/api/v1/sessions", json=request)
            self.assertEqual(response.status_code, 201)
            session = response.json()
            self.assertEqual(session["equipment"], profile)
            updated = await client.put(f"/api/v1/equipment/{profile['id']}", json={**layout, "width_mm": 800})
            self.assertEqual(updated.status_code, 200)
            finished = await client.post(f"/api/v1/sessions/{session['id']}/finish")
            self.assertEqual(finished.json()["equipment"], profile)

        restarted = create_app("simulator")
        async with restarted.router.lifespan_context(restarted), AsyncClient(
            transport=ASGITransport(app=restarted), base_url="http://test"
        ) as client:
            self.assertEqual((await client.get("/api/v1/sessions")).json(), [finished.json()])
            self.assertEqual((await client.get("/api/v1/equipment")).json()[0]["width_mm"], 800)

    async def test_placement_history_is_ordered_and_keeps_the_starting_layout(self):
        directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict("os.environ", {
            "THERMIQ_SESSION_DB": str(Path(directory) / "sessions.sqlite3"),
        }))
        probe = {"probe_id": "sim-probe-1", "x_mm": 200, "y_mm": 200,
                 "angle_deg": 0, "insertion_mm": 60}
        app = create_app("simulator")
        async with app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            profile = (await client.post("/api/v1/equipment", json={
                "name": "Smoker", "shape": "rectangular", "width_mm": 600,
                "depth_mm": 400, "height_mm": 300, "probes": [probe],
            })).json()
            session = (await client.post("/api/v1/sessions", json={
                "name": "Placement test", "equipment_id": profile["id"],
            })).json()
            session_url = f"/api/v1/sessions/{session['id']}"
            endpoint = f"{session_url}/placements"
            self.assertEqual((await client.get(endpoint)).json(), [])
            moved = {"revision": 0, "food": [], "probes": [{**probe, "x_mm": 300}]}
            invalid = {**moved, "probes": [{**probe, "x_mm": 590}]}
            self.assertEqual((await client.post(endpoint, json=invalid)).status_code, 422)
            first = await client.post(endpoint, json=moved)
            self.assertEqual(first.status_code, 201)
            self.assertEqual((await client.post(endpoint, json=moved)).status_code, 409)
            second = await client.post(endpoint, json={
                **moved, "revision": 1, "probes": [{**probe, "angle_deg": 90}],
            })
            self.assertEqual(second.status_code, 201)
            self.assertLessEqual(first.json()["recorded_at"], second.json()["recorded_at"])
            finished = (await client.post(f"{session_url}/finish")).json()
            self.assertEqual(finished["equipment"], profile)
            self.assertEqual((await client.post(endpoint, json={**moved, "revision": 2})).status_code, 409)

        restarted = create_app("simulator")
        async with restarted.router.lifespan_context(restarted), AsyncClient(
            transport=ASGITransport(app=restarted), base_url="http://test"
        ) as client:
            self.assertEqual((await client.get(endpoint)).json(), [first.json(), second.json()])
            self.assertEqual((await client.get("/api/v1/equipment")).json(), [profile])

    async def test_relay_readings_are_captured_by_the_matching_cook_mode(self):
        directory = self.enterContext(TemporaryDirectory())
        token = "test-relay-secret" * 3
        self.enterContext(patch.dict("os.environ", {
            "THERMIQ_SESSION_DB": str(Path(directory) / "sessions.sqlite3"),
            "THERMIQ_RELAY_DB": str(Path(directory) / "relay.sqlite3"),
            "THERMIQ_RELAY_TOKEN": token,
        }))
        app = create_app("ble_simulator")
        async with app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            session = (await client.post("/api/v1/sessions", json={"name": "Relay test"})).json()
            self.assertEqual(session["capture_mode"], "ble_simulator")
            payload = {
                "sample_id": str(uuid4()), "probe_id": "relay-probe",
                "measured_at": datetime.now(UTC).isoformat(), "simulated": True,
                "values": {"ambient_temperature": 110},
            }
            self.assertEqual((await client.post("/api/v1/relay/readings", json=payload, headers={
                "Authorization": f"Bearer {token}",
            })).status_code, 200)
            endpoint = f"/api/v1/sessions/{session['id']}/history"
            async with asyncio.timeout(6):
                while not (frames := (await client.get(endpoint)).json()["snapshots"]):
                    await asyncio.sleep(0.1)
            self.assertEqual(frames[0]["device_id"], "simulated-relay")
            self.assertEqual(frames[0]["readings"][0]["temperature_c"], 110)
        simulator = create_app("simulator")
        async with simulator.router.lifespan_context(simulator), AsyncClient(
            transport=ASGITransport(app=simulator), base_url="http://test"
        ) as client:
            await asyncio.sleep(2.1)
            self.assertEqual((await client.get(endpoint)).json()["snapshots"], frames)

    async def test_public_view_only_shows_current_cook_and_latest_placement(self):
        directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict("os.environ", {
            "THERMIQ_SESSION_DB": str(Path(directory) / "sessions.sqlite3"),
        }))
        app = create_app("simulator")
        async with app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            view = "/api/v1/view/active-cook"
            self.assertIsNone((await client.get(view)).json())
            profile = (await client.post("/api/v1/equipment", json={
                "name": "Smoker", "shape": "rectangular", "width_mm": 600,
                "depth_mm": 400, "height_mm": 300,
            })).json()
            started = (await client.post("/api/v1/sessions", json={
                "name": "Public cook", "equipment_id": profile["id"],
            })).json()
            session_url = f"/api/v1/sessions/{started['id']}"
            placement = await client.post(f"{session_url}/placements", json={
                "revision": 0, "food": [], "probes": [
                    {"probe_id": "sim-probe-1", "x_mm": 100, "y_mm": 100, "angle_deg": 0, "insertion_mm": 50},
                ],
            })
            self.assertEqual(placement.status_code, 201)
            active = (await client.get(view)).json()
            self.assertEqual(active["name"], "Public cook")
            self.assertEqual(active["layout"]["probes"][0]["probe_id"], "sim-probe-1")
            self.assertEqual(datetime.fromisoformat(active["layout_since"]),
                             datetime.fromisoformat(placement.json()["recorded_at"]))
            self.assertNotIn("id", active)
            self.assertNotIn("id", active["layout"])
            await client.post(f"{session_url}/finish")
            self.assertIsNone((await client.get(view)).json())
