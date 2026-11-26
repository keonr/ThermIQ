import csv
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient

from main import create_app
from simulator import simulate_snapshot


class CookReportTests(IsolatedAsyncioTestCase):
    async def test_saved_comparison_and_calibration_use_captured_data(self):
        directory = self.enterContext(TemporaryDirectory())
        path = str(Path(directory) / "sessions.sqlite3")
        self.enterContext(patch.dict("os.environ", {"THERMIQ_SESSION_DB": path}))
        app = create_app("simulator")
        async with app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            profile = (await client.post("/api/v1/equipment", json={
                "name": "Calibration smoker", "shape": "rectangular",
                "width_mm": 600, "depth_mm": 400, "height_mm": 300,
                "probes": [{"probe_id": "sim-probe-1", "x_mm": 200, "y_mm": 200,
                            "angle_deg": 0, "insertion_mm": 60}],
            })).json()
            session = (await client.post("/api/v1/sessions", json={
                "name": "Calibration cook", "equipment_id": profile["id"],
            })).json()
            endpoint = f"/api/v1/sessions/{session['id']}"
            self.assertEqual((await client.get(f"{endpoint}/summary")).status_code, 409)
            end = datetime(2026, 1, 1, tzinfo=UTC)
            start = end - timedelta(seconds=30)
            with sqlite3.connect(path) as db:
                db.execute("UPDATE cook_sessions SET started_at = ?, ended_at = ? WHERE id = ?",
                           (start.isoformat(timespec="microseconds"), end.isoformat(timespec="microseconds"), session["id"]))
                for seconds in (20, 25, 29):
                    at = start + timedelta(seconds=seconds)
                    db.execute("INSERT INTO cook_snapshots(session_id, observed_at, payload) VALUES (?, ?, ?)",
                               (session["id"], at.isoformat(timespec="microseconds"), simulate_snapshot(at).model_dump_json()))
            summary = (await client.get(f"{endpoint}/summary")).json()
            self.assertEqual(summary["duration_s"], 30)
            self.assertEqual(summary["sample_count"], 3)
            self.assertEqual(summary["ambient"]["count"], 12)
            self.assertEqual([frame["elapsed_s"] for frame in summary["frames"]], [20, 25, 29])
            exported = await client.get(f"{endpoint}/export?format=json")
            self.assertEqual(exported.status_code, 200)
            self.assertEqual(exported.json()["session"]["id"], session["id"])
            self.assertEqual(len(exported.json()["snapshots"]), 3)
            exported = await client.get(f"{endpoint}/export?format=csv")
            rows = list(csv.DictReader(exported.text.splitlines()))
            self.assertEqual(len(rows), 36)
            self.assertEqual(rows[0]["source"], "simulator")
            self.assertTrue(rows[0]["measured_at"])
            report_request = {"session_id": session["id"], "minutes": 0.2, "setpoint_c": 120, "chamber_load": "empty"}
            result = await client.post("/api/v1/calibrations", json=report_request)
            self.assertEqual(result.status_code, 201)
            report = result.json()
            self.assertTrue(report["simulated"])
            self.assertEqual(report["locations"][0]["count"], 3)
            self.assertEqual(report["locations"][0]["probe_id"], "sim-probe-1")
            self.assertEqual((await client.post("/api/v1/calibrations", json={**report_request, "minutes": 1})).status_code, 422)

        restarted = create_app("simulator")
        async with restarted.router.lifespan_context(restarted), AsyncClient(
            transport=ASGITransport(app=restarted), base_url="http://test"
        ) as client:
            self.assertEqual((await client.get("/api/v1/calibrations")).json(), [report])
