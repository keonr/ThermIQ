from datetime import UTC, datetime, timedelta
from struct import pack
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase

from httpx import ASGITransport, AsyncClient

from direct_ble import CHEF_IQ_COMPANY_ID, decode_advertisement
from main import create_app

ADDRESS = "AA:BB:CC:DD:EE:FF"
TEMPERATURE = b"\x01\x50" + pack("<6h", 1200, 624, -1, 32767, 630, 640)
STATUS = b"\x03\x50" + bytes.fromhex("aabbccddeeff") + bytes((85, 33))


class DecoderTests(TestCase):
    def test_temperature_status_and_hub_filter(self):
        values = decode_advertisement(TEMPERATURE, ADDRESS)
        self.assertEqual(values["food_temperature"], 62.4)
        self.assertEqual(values["probe_tip_1_temperature"], -0.1)
        self.assertIsNone(values["probe_tip_2_temperature"])
        self.assertEqual(decode_advertisement(STATUS, ADDRESS)["battery_percent"], 85)
        self.assertEqual(decode_advertisement(STATUS, "00000000-1111-2222-3333-444444444444")["soc_temperature"], 33)
        self.assertEqual(decode_advertisement(STATUS, "00:00:00:00:00:00"), {})
        self.assertEqual(decode_advertisement(TEMPERATURE + bytes(7), ADDRESS), {})
        self.assertEqual(decode_advertisement(TEMPERATURE[:-1], ADDRESS), {})


class DirectScanTests(IsolatedAsyncioTestCase):
    async def test_start_discover_channels_and_stop(self):
        scanners = []

        class Scanner:
            def __init__(self, detection_callback):
                self.receive = detection_callback
                self.stopped = False
                scanners.append(self)

            async def start(self):
                return None

            async def stop(self):
                self.stopped = True

        path = "/api/v1/bluetooth/scan"
        app = create_app("ble_direct", scanner_factory=Scanner)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            self.assertEqual((await client.get("/api/v1/telemetry")).status_code, 503)
            self.assertEqual((await client.post(path)).status_code, 403)
            headers = {"X-ThermIQ-Local": "1"}
            self.assertEqual((await client.post(path, headers=headers)).json(), {"scanning": True, "probe_count": 0})
            self.assertEqual((await client.post(path, headers=headers)).status_code, 200)
            self.assertEqual(len(scanners), 1)
            device = SimpleNamespace(address=ADDRESS)
            for data in (TEMPERATURE, STATUS):
                scanners[0].receive(device, SimpleNamespace(manufacturer_data={CHEF_IQ_COMPANY_ID: data}))
            self.assertEqual((await client.get(path)).json()["probe_count"], 1)
            snapshot = (await client.get("/api/v1/telemetry")).json()
            self.assertEqual(snapshot["device_id"], "direct-ble")
            self.assertEqual(len(snapshot["readings"]), 8)
            measured = datetime.fromisoformat(snapshot["observed_at"])
            self.assertLess(datetime.now(UTC) - measured, timedelta(seconds=5))
            self.assertEqual((await client.delete(path, headers=headers)).json(), {"scanning": False, "probe_count": 0})
            self.assertTrue(scanners[0].stopped)
            self.assertEqual((await client.get("/api/v1/telemetry")).status_code, 503)
