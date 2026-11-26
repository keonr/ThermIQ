# Chef iQ cloud API discovery (archived)

ThermIQ now uses Wi-Fi relay ingestion for BLE readings. See the [active relay contract](BLE_RELAY.md).

## Evidence reviewed on 2026-11-22

- Chef iQ lists the four-probe CQ60 kit and describes the Smart Hub as a Wi-Fi base station that enables remote monitoring in the companion app. [Chef iQ product listing](https://chefiq.com/products/iq-sense?variant=41324717277259)
- The vendor FAQ covers setup, Wi-Fi and Bluetooth behavior, and Gen 3 hardware. [iQ Sense FAQ](https://chefiq.com/pages/new-iq-sense-faq)
- Home Assistant's CQ60 integration receives probe broadcasts over Bluetooth. It provides no hub or cloud access. [Home Assistant integration](https://www.home-assistant.io/integrations/chef_iq/)
- Searches for vendor developer documentation, authentication, MQTT, and cloud telemetry did not identify a verified third-party API for this model. The public product documentation verifies the companion app experience only.

## Open integration work

| Area | Status | Evidence required |
| --- | --- | --- |
| API access | Unverified | Vendor-supported interface or authorized integration details, including environment and usage limits |
| Authentication | Untested | Supported credential type, scope, login or token issuance, renewal, and revocation behavior |
| Device discovery | Untested | Authorized account discovery result identifying the paired hub and four stable probe identifiers |
| Telemetry | Untested | Timestamp, channel, units, missing values, offline behavior, and rate limits verified against the companion app |

Validation requires an authorized test account with a paired Wi-Fi hub and four probes plus the vendor-approved integration method. Keep credentials in server-side secret storage. Keep any fixtures synthetic or redact identifying and authentication material before committing.

## Hardware validation sequence

1. Pair the hub in the Chef iQ app, confirm Wi-Fi remote monitoring, and record the hub model and firmware.
2. Authenticate using the approved API mechanism. Check read-only access, expiry, and recovery.
3. Discover the hub and its four probes. Compare stable identifiers across restarts and reconnects.
4. Warm one probe at a time within its operating limits. Compare identity, internal and ambient channels where exposed, units, and timestamps with app readings.
5. Disconnect one probe and then the hub. Capture missing or stale data behavior, reconnect, and check recovery without assigning old data a fresh timestamp.

The earlier cloud mode has been removed.

## Capability matrix

| Capability | Companion app / product documentation | Cloud adapter | Published BLE parser |
| --- | --- | --- | --- |
| Four probes and remote monitoring | CQ60 four-probe kit and Wi-Fi Smart Hub documented | Account enumeration and simultaneous readings unverified | Passive probe data supported by library, physical four-probe check pending |
| Internal shaft and ambient | Vendor documents internal and ambient sensing | Channel availability and units unverified | Parser documents ambient and three or four shaft channels, depending on protocol |
| Core value | Vendor advertises core temperature in its product material | Availability unverified | Verify availability separately from raw readings before mapping a channel |
| Battery and diagnostics | No API evidence | Unverified | Parser documents battery and SoC temperature channels |
| Identity and connection | App pairing documented | Device IDs, refresh/expiration, polling or streaming, rate limits and latency unverified | Parser detects supported major versions and looks beyond the manufacturer identifier to distinguish probes |
| Measurement timing | Remote monitoring advertised | Timestamp provenance and delivery latency unverified | Verify advertised cadence and compare gateway reception time with app behavior |

Library findings describe its documented interface. ThermIQ has yet to test decoding or scanning against physical hardware. Record firmware, discovery/reconnect behavior, battery and stale/sentinel behavior on Linux before enabling the BLE gateway. [chefiq-ble source](https://github.com/Invader444/chefiq-ble) · [PyPI package documentation](https://pypi.org/project/chefiq-ble/)

## Architecture decisions

- Place provider selection on the API server. The browser calls ThermIQ's same-origin endpoint and receives no vendor credentials.
- Represent acquisition failure as unavailable. Switch to the simulator only through explicit configuration.
- Use source-qualified, individually identified channels. Preserve raw sensor identity for subsequent persistence and analytics.
