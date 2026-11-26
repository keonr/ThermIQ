# ThermIQ ATOM Lite bench scanner

Target hardware is the M5Stack ATOM Lite C008 with ESP32-PICO-D4. The firmware
listens passively for Chef iQ CQ60 protocol 5.x advertisements and prints
decoded JSON lines over USB serial. The bench scanner works without probe pairing or Wi-Fi credentials. The
separate relay target adds authenticated Wi-Fi delivery.

## Build and flash

Install PlatformIO Core, then plug the ATOM Lite into your computer with a
USB data cable. Run these commands from `gateway/ble`:

```sh
pio run -e m5stack-atom
pio device list
pio run -e m5stack-atom -t upload
pio device monitor -b 115200
```

Use `--upload-port PORT` and `--port PORT` if more than one serial device
is attached. Close the monitor before uploading again. If you miss the
startup message, reopen the monitor and reset the board. Flashing replaces
the currently installed firmware.

## Verify four probes

1. Wake or remove all four probes from the hub. Keep them near the ATOM Lite
   and check for `{"status":"scanning"}`.
2. Count four distinct `probe_id` values. Temporarily return one probe to the
   hub or warm one probe using normal operating conditions to match each ID
   with its physical probe. Verify IDs remain consistent after a board reset.
3. Compare food-core and ambient readings with the Chef iQ app. Shaft channels
   print `null` when the probe explicitly reports missing data. Battery and chip
   temperature may arrive on their own lines. Temperatures are Celsius.
4. Repeat near the smoker with its lid closed and the relay outside the metal
   chamber. Check which probe IDs continue to report and record their RSSI.

The scanner reports USB uptime and RSSI alongside the decoded fields. Its JSON
is diagnostic output for the bench test. ThermIQ ingest will also require a
sample UUID and an absolute measurement timestamp. Use an authorized capture
and redact probe addresses before sharing it outside your own setup.

## Run the decoder tests

From `gateway/ble`:

```sh
c++ -std=c++11 -Wall -Wextra -Werror -I include src/cq60.cpp tests/cq60_test.cpp -o /tmp/cq60-test
/tmp/cq60-test
```

The tests use synthetic packets based on the published format. Protocol 5
temperature and status layouts come from the pinned [chefiq-ble parser](https://github.com/Invader444/chefiq-ble/blob/ad345a784256dd3636ede7275af6407e25285fd4/src/chefiq_ble/parser.py).
Status packets must contain the matching advertised address. Longer hub
payloads, unknown protocol majors and malformed packets are discarded.

[M5Stack board documentation](https://docs.m5stack.com/en/core/Atom-Lite)

## Send real readings to ThermIQ over Wi-Fi

1. Configure the ThermIQ backend in `ble` mode with a relay token. Make its
   ingest endpoint reachable over HTTPS from the relay's Wi-Fi network. See
   the [server setup](../../docs/BLE_RELAY.md#bonjour-hostname-support) for Mac Bonjour. Use a hostname that
   matches the server certificate and a 2.4 GHz Wi-Fi network.
2. Copy `include/relay_config.example.hpp` to `include/relay_config.hpp`.
   Set the Wi-Fi credentials, HTTPS ingest URL, shared relay token, and
   the CA certificate that signed the server certificate. The config
   header is ignored by Git. Keep the configured firmware image private
   because it contains the credentials.
3. From `gateway/ble`, build and flash the relay target:

   ```sh
   pio run -e m5stack-atom-relay
   pio run -e m5stack-atom-relay -t upload
   pio device monitor -b 115200
   ```

4. Reset the board with probes awake. The relay synchronizes its clock with
   NTP before posting. Confirm `"status":"uploaded"` in serial and match
   each probe to the ThermIQ dashboard. For a bench check, the original
   `m5stack-atom` target still prints decoded readings to USB.

The relay rate-limits each probe's temperature and status packets separately.
Up to 256 queued readings are buffered in RAM during an outage. Retries keep
the original sample ID and timestamp and use backoff. If the queue fills, the
relay reports dropped readings and retains the older queued samples. Power
loss or a reset clears the queue. Test Wi-Fi interruption and recovery on the
physical board before relying on it during a cook.
