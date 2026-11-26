"""Receive CQ60 advertisements through the API host's Bluetooth adapter."""

import asyncio
from datetime import UTC, datetime, timedelta
from string import hexdigits
from struct import unpack_from

from providers import ProviderUnavailable
from relay import CHANNELS
from telemetry import Probe, SensorReading, TelemetrySnapshot

CHEF_IQ_COMPANY_ID = 0x05CD
DIRECT_DEVICE_ID = "direct-ble"
TEMPERATURE_FIELDS = (
    "ambient_temperature", "food_temperature",
    *(f"probe_tip_{number}_temperature" for number in range(1, 5)),
)


def decode_advertisement(payload: bytes, address: str) -> dict[str, float | None]:
    """Decode protocol 5.x manufacturer data after Bleak strips the company ID."""
    if not 2 <= len(payload) <= 18 or payload[1] >> 4 != 5:
        return {}
    packet_type = payload[0] & 0x0F
    if packet_type == 1 and len(payload) >= 14:
        values = unpack_from("<6h", payload, 2)
        if any(value < -400 or 6000 < value < 32000 for value in values):
            return {}
        return {
            field: None if value >= 32000 else value / 10
            for field, value in zip(TEMPERATURE_FIELDS, values, strict=True)
        }
    if packet_type == 3 and len(payload) >= 10:
        raw_address = address.replace(":", "")
        if len(raw_address) == 12 and all(character in hexdigits for character in raw_address):
            if payload[2:8] != bytes.fromhex(raw_address):
                return {}
        # CoreBluetooth identifies devices by UUID rather than their on-air MAC.
        return {"battery_percent": payload[8] if payload[8] <= 100 else None,
                "soc_temperature": payload[9]}
    return {}


class DirectBluetoothProvider:
    def __init__(self, scanner_factory=None):
        self.scanner_factory = scanner_factory
        self.scanner = None
        self.lock = asyncio.Lock()
        self.readings: dict[str, dict[str, SensorReading]] = {}

    def status(self) -> dict[str, bool | int]:
        return {"scanning": self.scanner is not None, "probe_count": len(self.readings)}

    async def start(self):
        async with self.lock:
            if self.scanner is not None:
                return
            factory = self.scanner_factory
            if factory is None:
                try:
                    from bleak import BleakScanner
                except ImportError as error:
                    raise ProviderUnavailable("Install requirements-ble.txt to enable direct Bluetooth.") from error
                factory = BleakScanner
            self.readings.clear()
            # macOS requires CoreBluetooth's active discovery mode. No GATT connection is made.
            try:
                scanner = factory(detection_callback=self.on_advertisement)
                await scanner.start()
            except Exception as error:
                self.readings.clear()
                raise ProviderUnavailable(
                    f"Could not start Bluetooth scanning. Check the host adapter and Bluetooth permissions. {error}"
                ) from error
            self.scanner = scanner

    async def stop(self):
        async with self.lock:
            if self.scanner is not None:
                try:
                    await self.scanner.stop()
                except Exception as error:
                    raise ProviderUnavailable(f"Could not stop Bluetooth scanning. {error}") from error
                self.scanner = None
                self.readings.clear()

    def on_advertisement(self, device, advertisement):
        address = device.address.lower()
        data = advertisement.manufacturer_data.get(CHEF_IQ_COMPANY_ID)
        if data is None:
            return
        values = decode_advertisement(data, address)
        if not values or (address not in self.readings and len(self.readings) >= 32):
            return
        now = datetime.now(UTC)
        readings = self.readings.setdefault(address, {})
        for channel, value in values.items():
            kind, index = CHANNELS[channel]
            readings[channel] = SensorReading(
                device_id=DIRECT_DEVICE_ID, probe_id=address, sensor_id=f"{address}/{channel}",
                sensor_type=kind, sensor_index=index, temperature_c=value if kind != "battery" else None,
                battery_percent=value if kind == "battery" else None, measured_at=now, received_at=now,
                source="ble", quality="missing" if value is None else "valid", simulated=False,
            )

    async def latest_snapshot(self) -> TelemetrySnapshot:
        if self.scanner is None:
            raise ProviderUnavailable("Start Bluetooth scanning to discover nearby probes.")
        if not self.readings:
            raise ProviderUnavailable("Scanning for CQ60 probes. Wake the probes and move them near this computer.")
        cutoff = datetime.now(UTC) - timedelta(seconds=30)
        readings = [
            reading.model_copy(update={"quality": "stale"}) if reading.measured_at < cutoff else reading
            for channels in self.readings.values() for reading in channels.values()
        ]
        return TelemetrySnapshot(
            source="ble", device_id=DIRECT_DEVICE_ID, observed_at=max(item.measured_at for item in readings),
            probes=[Probe(id=address, name=f"CQ60 {address.replace(':', '')[-6:]}") for address in self.readings],
            readings=readings,
        )
