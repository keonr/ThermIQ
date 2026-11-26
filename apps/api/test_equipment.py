from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from main import create_app


class EquipmentTests(IsolatedAsyncioTestCase):
    async def test_layout_validation_update_and_restart(self):
        directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict("os.environ", {
            "THERMIQ_SESSION_DB": str(Path(directory) / "sessions.sqlite3"),
        }))
        endpoint = "/api/v1/equipment"
        layout = {
            "name": "Backyard smoker", "shape": "rectangular",
            "width_mm": 600, "depth_mm": 400, "height_mm": 300,
            "food": [{"id": str(uuid4()), "name": "Roast", "x_mm": 200, "y_mm": 200,
                      "angle_deg": 90, "width_mm": 250, "depth_mm": 100}],
            "probes": [{"probe_id": "sim-probe-1", "x_mm": 180, "y_mm": 200,
                        "angle_deg": 0, "insertion_mm": 50}],
        }
        app = create_app("simulator")
        async with app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            result = await client.post(endpoint, json=layout)
            self.assertEqual(result.status_code, 201)
            profile = result.json()
            url = f"{endpoint}/{profile['id']}"
            rotated_outside = {**layout, "food": [{**layout["food"][0], "y_mm": 100}]}
            self.assertEqual((await client.put(url, json=rotated_outside)).status_code, 422)
            circular_corner = {**layout, "shape": "cylindrical", "depth_mm": 600, "food": [],
                               "probes": [{**layout["probes"][0], "x_mm": 0, "y_mm": 0}]}
            self.assertEqual((await client.put(url, json=circular_corner)).status_code, 422)
            changed = await client.put(url, json={**layout, "name": "Smoker test layout"})
            self.assertEqual(changed.status_code, 200)
            self.assertEqual(changed.json()["id"], profile["id"])

        restarted = create_app("simulator")
        async with restarted.router.lifespan_context(restarted), AsyncClient(
            transport=ASGITransport(app=restarted), base_url="http://test"
        ) as client:
            self.assertEqual((await client.get(endpoint)).json(), [changed.json()])
