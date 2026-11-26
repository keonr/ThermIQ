# BLE relay ingestion

ThermIQ accepts decoded BLE measurements from a single Wi-Fi relay through
`POST /api/v1/relay/readings`. The host stores samples in SQLite and serves the
latest reading per probe and channel through the dashboard telemetry endpoint.

## Configure

1. Set `THERMIQ_TELEMETRY_SOURCE=ble_simulator` for synthetic POST requests or
   `THERMIQ_TELEMETRY_SOURCE=ble` for hardware.
2. Generate a random token with `python -c "import secrets; print(secrets.token_urlsafe(32))"`
   and set it as `THERMIQ_RELAY_TOKEN` in the API environment or the ignored Compose
   `.env`. Configure the same secret on the sender. Use `Authorization: Bearer <token>`.
3. Run `docker compose up --build`. Compose persists the database in `relay-data`.
   With local Uvicorn, `THERMIQ_RELAY_DB` defaults to `relay.sqlite3`.
4. Give the relay an HTTPS URL it can reach. Its hostname must match the
   server certificate. Configure the relay to trust the CA that issued it.

## Send a synthetic sample

With the API running in `ble_simulator` mode, export the configured token in your
shell, then run this example. Open the dashboard to see the synthetic probe.

```sh
python -c 'import json, uuid; from datetime import datetime, UTC; print(json.dumps({"sample_id": str(uuid.uuid4()), "probe_id": "demo-probe-1", "measured_at": datetime.now(UTC).isoformat(), "simulated": True, "values": {"food_temperature": 62.4, "ambient_temperature": 122, "probe_tip_1_temperature": 64.1, "battery_percent": 87, "soc_temperature": 34}}))' |
  curl -fsS http://127.0.0.1:8080/api/v1/relay/readings \
    -H "Authorization: Bearer $THERMIQ_RELAY_TOKEN" \
    -H "Content-Type: application/json" --data-binary @-
```

For local Uvicorn, target port 8000. The default `simulator` mode continues to
produce four probes automatically.

## Payload contract

- Send one decoded update for one stable `probe_id` per POST. Use a UUID
  `sample_id` that stays the same when the relay retries the same update.
- The server returns `{"stored":true}` for a new sample and `{"stored":false}`
  for an identical retry. Changing the payload of a stored sample ID returns
  HTTP 409. The ATOM Lite relay queues unsent samples in RAM.
- Record when the relay received the advertisement as `measured_at`, with a
  timezone. The API normalizes it to UTC and adds its own reception time.
  Synchronize the relay clock. The API rejects timestamps over five seconds
  ahead of the server clock and accepts delayed samples for logging.
- Use the decoded chefiq-ble keys `food_temperature`, `ambient_temperature`,
  `probe_tip_1_temperature` through `probe_tip_4_temperature`, `battery_percent`
  and `soc_temperature`. Temperatures are in Celsius. Keep food core separate
  from shaft channels and keep battery and SoC separate from food readings.
- Omit channels absent from the current advertisement. Use JSON `null` for a
  channel explicitly reported as missing. Decode device sentinels before
  sending values. At least one channel is required.
- The latest view orders channels by measurement time. Readings older than 30
  seconds are marked stale. Older samples remain stored. Historical queries and
  retention policy are pending.
- The server accepts synthetic payloads only in `ble_simulator` mode. The hardware
  dashboard reads the separate hardware partition.

The published parser documents these decoded keys and the division of CQ60 readings
between temperature and status packets. ThermIQ tests use synthetic payloads.
Physical testing of the ATOM Lite relay and probes is pending. [chefiq-ble](https://pypi.org/project/chefiq-ble/)

Start a cook from the dashboard in either relay mode to capture the latest
relay feed about every two seconds. Session playback uses saved snapshots,
while the relay database retains the raw accepted updates, including late
arrivals. Use the same acquisition mode when restarting an active cook.

## ATOM Lite bench scanner

The [scanner project](../gateway/ble/README.md) builds for the M5Stack ATOM Lite
C008. It listens for CQ60 protocol 5.x and prints decoded readings over USB.
Follow its four-probe bench checklist, then build the Wi-Fi relay target with
the server URL, relay token and trusted CA certificate.

## Direct Bluetooth from a Mac

Direct mode uses the Mac's Bluetooth adapter through Bleak and CoreBluetooth.
It runs ThermIQ natively on the Mac so the API can access the adapter. The
ATOM Lite, an HTTPS proxy, and a relay token are unnecessary in this mode.
The development server binds to localhost.

With Python 3.12+ and Node.js installed, run from the ThermIQ checkout:

```sh
bash scripts/run_direct_ble.sh
```

Open http://127.0.0.1:5173 and choose **Start Bluetooth scan**. If macOS asks
for Bluetooth access, allow it for the terminal application running ThermIQ.
If scanning fails, check Bluetooth is on and review **System Settings →
Privacy & Security → Bluetooth**. Wake the probes and move them near the Mac.
Found probes appear automatically in the dashboard and can be used in a cook.
The scan continues while the local service runs, until you choose **Stop
Bluetooth scan** or stop the server.

macOS uses active BLE discovery here. ThermIQ reads advertisements without a
GATT connection or pairing. macOS supplies CoreBluetooth identifiers, so
existing ATOM Lite placements that use MAC addresses need to be mapped to the
newly discovered direct probe IDs. Linux native mode also uses Bleak and
requires a working host BlueZ adapter. Physical discovery is unverified in
this workspace.

## Bonjour hostname support

The ATOM Lite can resolve a `.local` hostname over mDNS on the same
multicast-capable LAN. Use the hostname from the server certificate in
`RELAY_URL` and its issuing CA certificate in `RELAY_CA_PEM`. The firmware
retains the hostname for TLS certificate verification.
