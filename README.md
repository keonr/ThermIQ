# ThermIQ

ThermIQ is a self-hostable spatial cooking intelligence platform targeting the Chef iQ iQ Sense Gen 3 / CQ60 four-probe kit. The first increment provides a temperature dashboard with food-core, shaft and ambient readings from four synthetic probes. ThermIQ accepts decoded probe readings from a Wi-Fi BLE relay. Physical relay verification is pending.

## Run the simulator

Install Docker with Compose, then run from the repository root:

```sh
docker compose up --build
```

Open http://localhost:8080. The dashboard updates approximately every two seconds and displays the source, sample time and selected temperature unit. Select food core or ambient to compare probes on the rolling chart. Chart history stays in the current tab. This development deployment binds to loopback because user authentication is pending.

## Local development

Use Python 3.12+ and Node 22.18+ (or Node 24). In one terminal:

```sh
cd apps/api
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m uvicorn main:app --reload
```

On Windows PowerShell, activate with `.venv\Scripts\Activate.ps1`. In a second terminal:

```sh
cd apps/web
npm ci
npm run dev
```

Open http://localhost:5173. FastAPI OpenAPI documentation is available at http://localhost:8000/docs in local development.

## Verification

- API tests from `apps/api` use `python -m unittest -v`.
- Web tests and production build from `apps/web` use `npm test` and `npm run build`.
- Run `docker compose config --quiet` from the root to validate the Compose configuration.

## Source configuration

Set `THERMIQ_TELEMETRY_SOURCE` in the API process environment or in a root `.env` file for Compose.

| Value | Behavior |
| --- | --- |
| `simulator` | Default. Generates four synthetic probes without credentials. |
| `ble_simulator` | Accepts synthetic relay payloads and displays the simulator label. |
| `ble` | Accepts hardware relay payloads. |

## Project status

The scaffold includes a versioned telemetry endpoint, simulator, and dashboard. See the [release specification](docs/SPECIFICATION.md) for all eight MVP features and the [BLE relay guide](docs/BLE_RELAY.md) for setup, payloads and validation.

### Simulator scenarios

Set `THERMIQ_SIMULATOR_SCENARIO` in the API environment or Compose `.env`:

- `uniform` generates similar ambient temperatures across all four probes.
- `hot-right` generates a 15°C ambient difference between the first and fourth simulated probes.
- `probe-removal` marks all channels on probe 4 as missing during the final 15 seconds of each UTC minute and restores them at the next minute.

Readings are deterministic for the same scenario and timestamp. These scenarios model sample behavior without a physical chamber.

## Save a simulated cook

In the default `simulator` mode, enter a name under **Cook sessions** and select
**Start cook**. The API records a snapshot about every two seconds,
including when the dashboard is closed. Select **Finish cook** to open its saved
chart. After restarting, choose the cook from the session list to reopen its
readings. Long cooks have earlier and later chart pages.

ThermIQ supports one active cook at a time using the configured simulator or relay feed. Each cook keeps its starting acquisition mode.
Compose keeps session data in its existing named volume. For local Uvicorn, use
`THERMIQ_SESSION_DB` to override the default `sessions.sqlite3` path. An active cook resumes sampling after a restart in the same acquisition mode, with a gap for downtime.

## Set up a chamber layout

Under **Equipment and chamber layout**, name a profile and set the chamber
shape and dimensions in millimeters. Add food and select a live probe to place.
Select a marker and tap the chamber to move it, or enter exact coordinates,
dimensions, and rotation. Save the layout and reopen it from the profile list.

The origin is the upper-left corner of the chamber's bounding rectangle. X
increases rightward, Y increases downward, and angles increase clockwise from
the positive X axis. Food coordinates are footprint centers. Probe coordinates
are insertion start points, with the displayed line extending by the entered
depth. The API validates the whole footprint and insertion segment against
the chamber boundary. Layouts share the cook-session database and its Compose
volume. This editor stores reusable profile layouts. Per-session placement
history, rack elevations, and 3D visualization are pending.

When starting a cook, choose a saved profile from the **Equipment** menu.
ThermIQ copies its chamber, food, and probe placement into the session. Reopen
the cook to see its starting layout alongside the temperature history. Later
profile edits apply to future cooks. Existing cooks and new cooks started with
**No layout** retain their temperature history.

During an active cook with equipment, use **Edit cook placements** to move or
rotate food and probes, then select **Record placement change**. Each save
records a UTC timestamp and a new layout revision. Reopen a finished cook and
use **Cook replay** to scrub through recorded temperatures and chamber
layouts together. Play or pause at 1×, 5×, 10×, 30×, or 60×, or select a placement
change to jump to its timestamp. Long cooks replay one chart page at a time.
Use **Earlier readings** and **Later readings** to move between pages.

### Replay ambient heat maps

For a cook with placed probes, the replay shows ambient samples at those
positions. Two distinct positions show a limited gradient along their line.
Three or more non-collinear positions support a 2D inverse-distance-weighted
estimate inside the area they enclose. Faded areas are farther from a probe,
and blank areas have no coverage. The color scale is relative to the current
samples. Probe entry points approximate the ambient sensor locations.

Replay ignores ambient readings older than six seconds at the playhead and
waits for new readings after any placement change. To try the full map with
the simulator, place at least three probes in a triangle before recording a
cook. The `hot-right` scenario gives the probes different ambient readings.

### Live cook insights

During a simulated cook, enter a core target and optional ambient limits to
see in-app alerts and time-to-target estimates. Acknowledgments and settings
are held in the current tab. Trend estimates require at least a minute of
recent readings and suppress unstable or very long estimates. The active
chamber view also shows a heat map and suggests checking placement or
repositioning food if two placed probe sites differ by at least 15°F for five
continuous minutes. Saving a placement revision starts a new analysis window.

### Compare cooks and calibrate equipment

Use **Compare cooks** to find two completed sessions and overlay ambient or
food-core curves by elapsed time. The summary shows cook duration, sample
count, and ambient variation. Long curves are sampled for display while
summary statistics use every valid reading.

For **Smoker calibration**, place probes at known locations and record a cook.
Let the chamber stabilize, keep the probes fixed during the measurement window,
then finish. Choose the cook, enter the setpoint and final sampling duration,
and save the calibration. Reports retain per-location ranges, mean, variation,
setpoint deviation, and coverage. Empty and loaded chamber reports are labeled
separately.

Finished cooks offer **Export CSV** for per-channel readings and **Export
JSON** for the session metadata and complete saved telemetry snapshots.

The calibration report maps per-location averages and can compare
matching probe positions with the previous run at the same setpoint and
chamber load. The replay and placement history also offer an interactive
3D view. Food and probes appear on the 2D layout plane because rack and
sensor elevations are not recorded yet.

Use **Enable browser alerts** during a cook to opt into desktop notifications
while its dashboard tab is open. Availability depends on browser permissions.
In-app alerts also show approaching targets and low battery when that channel
is present.

### Run the simulator browser test

With the Python API dependencies installed in the active environment, run
`npx playwright install chromium` and `npm run test:e2e` from `apps/web`.
To use an installed Chromium instead, set `THERMIQ_E2E_CHROMIUM` to its
executable path. The test starts both services with a temporary database and
exercises layout creation, live alerts, recording, replay, comparison, and
calibration.

### Direct Bluetooth on macOS

To scan for CQ60 probes with your Mac's built-in Bluetooth, run
`bash scripts/run_direct_ble.sh` from the checkout and open
http://127.0.0.1:5173. Click **Start Bluetooth scan**. See the
[direct Bluetooth setup](docs/BLE_RELAY.md#direct-bluetooth-from-a-mac) for
permissions and host requirements.

## Read-only dashboard

The Compose viewer is available at http://localhost:8081. It shows live
readings, charts, and the active cook's layout and heat map. The editable
dashboard is at http://localhost:8080. The viewer accepts only read requests
for live telemetry and active cook details.
