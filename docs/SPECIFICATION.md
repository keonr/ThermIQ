# ThermIQ product and technical specification

ThermIQ is a self-hostable, spatial cooking-monitoring and analysis application. Its primary target is a Chef iQ iQ Sense Gen 3 / CQ60 four-probe kit. Collect and retain available food-core, shaft, ambient, and device telemetry, map readings to a user-defined chamber, and use them to explain cooking progress and heat distribution. The primary workflow runs from configuring a smoker and placing food and probes through live monitoring, recommendations, replay, and comparison.

## Implementation order and status

A Wi-Fi relay forwards decoded BLE probe readings to ThermIQ. The backend accepts and logs readings from the relay and supports a separate synthetic relay mode. Relay firmware and physical verification are pending. The earlier cloud investigation is archived. See [BLE relay ingestion](BLE_RELAY.md).

| MVP feature | Requirements | First increment |
| --- | --- | --- |
| Live readings and historical charts | Four concurrent probes, separate sensor channels, session and connectivity status, ECharts overlays, adjustable windows, event annotations, CSV export, WebSocket updates | Simulator and relay cook capture, persistent temperature charts, placement markers, and CSV/JSON exports. |
| Interactive chamber and food positioning | Equipment and food profiles, editable food and probe geometry, authoritative 2D editor and synchronized inspection in 3D | Saved layouts, timestamped revisions, and synchronized 2D and 3D inspection. Rack and sensor elevations pending. |
| Heat distribution and rotation recommendations | Time-aligned ambient interpolation, uncertainty, persistent imbalance, actionable rotation or repositioning recommendations | Live and replay 2D heat maps and five-minute imbalance guidance. |
| Temperature and connectivity alerts | Configurable rules for targets, temperature, imbalance, stalls, connectivity, battery, prediction changes, actions and completion. Acknowledge and dismiss alerts | Live configurable core and ambient alerts, monitoring interruption, and in-tab acknowledgment and opt-in browser notifications. Web Push and email pending. |
| Time-to-target predictions | Robust and smoothed estimates, stall detection, uncertainty where supported, and insufficient-data states | Robust recent slope estimates with insufficient-data, unstable-trend and stall states. |
| Cooking session replay | Persist readings and geometry changes, reconstruct the historical state at the playhead, synchronize charts and events | Play, pause, scrub, speed controls and placement markers synchronized with saved readings and 2D layouts. Ambient heat maps available. Alerts and recommendations pending |
| Cook comparison and equipment profiles | Searchable session history, curve overlays and quantitative comparisons, reusable equipment, CSV and JSON export | Saved profiles, session search, elapsed-time curve overlays, duration and ambient variation. |
| Smoker calibration | Guided warm-up and sampling, comparison to setpoint, per-location metrics, hot and cold zones, saved calibration profiles | Saved final-window reports with per-probe statistics, heat maps, and prior-run comparisons. Automatic stabilization pending. |

## Architecture

- Use a local-first monorepo with `apps/web`, `apps/api`, `gateway/ble`, shared types, tests, deployment files and docs. Keep integration, security, domain logic, analytics and presentation independent.
- Web stack includes React, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Zustand, ECharts, React Konva, Three.js with React Three Fiber and Drei, WebSockets and installable PWA support.
- API stack includes Python 3.12+, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL in production, SQLite for single-node development, NumPy, SciPy, HTTPX, and a managed periodic worker. Add Bleak and chefiq-ble for the BLE milestone.
- Docker Compose separates frontend, API, database and optional gateway. Use a reverse proxy with HTTPS, environment configuration, secret storage, structured JSON logging, health checks, metrics and optional Redis coordination. Prefer permissive dependencies and document their versions and licenses.
- Support local development on Linux, macOS and Windows and deploy to Linux, Raspberry Pi and remote infrastructure. Target all-local, local gateway with remote server, and simulation modes. The current Compose demo uses loopback and has no account or database service.

## Acquisition and normalization

The target provider interface exposes asynchronous device discovery, connect and disconnect, capabilities, latest readings, streaming and status. Support the built-in simulator and decoded Chef iQ BLE data from a Wi-Fi relay. Deduplicate by device, sensor, source timestamp and acquisition context. Preserve conflicts and provenance and prefer the freshest valid measurement.

The first increment uses a smaller async snapshot boundary. `GET /api/health` reports process health and selected source. `GET /api/v1/telemetry` returns the current device, UTC observation timestamp, probes and channel readings. Relay modes return HTTP 503 while waiting for the first sample. The relay POST uses a dedicated bearer token and persists validated samples in SQLite.

A reading retains device, probe, sensor and optional sensor index, category, nullable Celsius temperature, UTC measurement and reception timestamps, source, quality and simulation status. Dynamically represent channels by identity. Categories are food core, shaft, ambient, battery, diagnostic and unknown. Keep manufacturer food core separate from shaft data and keep diagnostics and battery separate from temperature. Preserve native timestamps where available. Normalize unavailable, stale, unsupported and sentinel values. Keep raw, simulated, predicted and interpolated values distinguishable.

For later BLE research verify identity, protocol and packet decoding, sentinel behavior, sampling frequency, multi-probe parsing, sensor and battery capabilities, discovery and reconnect, hardware support and hub differences. Prefer passive scanning where supported, with per-probe parser state. A separate Linux/Raspberry Pi gateway discovers and decodes local advertisements, buffers outages, authenticates with scoped credentials, sends idempotent measurements, resends on reconnect and reports health. Document macOS and Windows limitations.

The full simulator needs deterministic seeded scenarios with configurable probe count and channels, multiple sessions, setpoints, hot/cold zones, heating, stalls, disconnections, drain, delayed or out-of-order data, missing readings, abrupt changes, door events and rotations. Include uniform pellet smoker, hot-side offset, vertical gradient, brisket, multi-probe turkey, network outage and probe removal.

## Database, API and security

Use UUIDs, foreign keys, tenant-scoped authorization, appropriate uniqueness, configurable retention and selective soft deletion, PostgreSQL JSONB where appropriate, migrations and a `(sensor_id, measured_at)` index. Keep raw readings and downsampled aggregates separate from computed analytics.

| Domain | Required tables |
| --- | --- |
| Accounts and audit | users, households, household_members, audit_events, notification_channels |
| Chamber | equipment_profiles, equipment_zones |
| Acquisition | devices, device_connections, probes, sensors, sensor_readings, gateways |
| Cook history | cooking_sessions, food_items, probe_placements, session_events |
| Analysis | calibration_runs, calibration_samples, heatmap_snapshots, predictions, alerts, recommendations |

Persist ownership and roles, device identity and capabilities, credential references, session and food state, probe placement effective intervals, model version, analytical evidence and affected resource or actor. Record rotations and probe moves as timestamped events.

Implement email/password accounts with Argon2id, secure sessions and cookies, CSRF protection where applicable, password reset, email verification when configured, progressive throttling or lockouts, and optional OIDC. Enforce owner, administrator, member and viewer roles on the server. Enforce household isolation on queries, mutation, export and WebSocket subscriptions. Keep relay credentials server-side and redact auth data from logs. Support scoped, revocable, rotatable gateway credentials. Require HTTPS for production and document privacy, retention, backup and restore.

Version resources under `/api/v1/` for auth, users, households, equipment, devices, probes, sensors, sessions, readings, heatmaps, predictions, recommendations, alerts, calibrations, history, gateways and settings. Validate and authorize requests, paginate and aggregate history, and describe REST with OpenAPI. Use `/ws/v1/sessions/{session_id}` for reading, probe and gateway status, session and geometry, heat-map, prediction, alert and recommendation events.

## Geometry and monitoring

Use millimeters and document origin, axes and orientation. Support rectangular and cylindrical chambers for pellet, offset, vertical, electric and custom smokers, kamados, charcoal and gas grills, and conventional/convection ovens. Profiles record interior dimensions, shape, racks, heat sources, vents, fans, doors, zones and setpoints.

Allow multiple food items with editable dimensions, shape, weight, location, orientation, desired temperature and optional completion time. Provide editable brisket, pork shoulder, ribs, roast, turkey, chicken, chicken breast, steak, sausage and custom presets. Probe placement records food, entry point, shaft direction, angle and depth, ambient point, sensor positions when known, and confidence. Warn on inconsistent placement.

The top-down editor supports zoom, pan, grid snapping, dragging, resizing, rotation, insertion vectors, overlays, zones, dimension labels, undo/redo and restore. The 3D view uses the same geometry for chamber, racks, food, shafts, sensors, heat-map planes, labels and axes, with orbit, zoom, pan and preset views.

Provide a dark, high-contrast, responsive instrumentation interface with large temperatures, touch controls, consistent probe colors, visible freshness and loading, empty, disconnected, error and simulation states. Include account, dashboard, equipment, geometry, live session, heat map, calibration, history, replay, comparison, device, alerts and administration screens. Live sessions show elapsed time, equipment, state, targets and connection. Probe cards show available temperatures, battery, trend, quality and last update. Charts overlay channels and targets, support zoom and annotate movements and rotations. Show progress, rise rate, predictions, stalls and recommended actions.

## Analysis and recommendations

- Align eligible ambient measurements by configurable time window and exclude stale or disconnected probes. Baseline IDW uses weight `1 / (distance² + epsilon²)^(q/2)` with default `q = 2`, smoothing distance `epsilon` and explicit coincident point handling. Show one probe as a point, two as a limited gradient, and three or four as interpolation with uncertainty. Flag extrapolation. Support an RBF strategy and optional Gaussian process after enough calibration.
- Confidence reflects coverage, spatial spread, distance, recency, quality, calibration and model disagreement. Show low confidence visually and keep heuristic confidence distinct from calibrated uncertainty. Sparse probes support approximate planes.
- Compute ambient range, standard deviation, mean absolute deviation, persistent zone differential, time outside range, stability, post-door recovery and asymmetry. A configurable starting imbalance threshold is 15°F sustained for five minutes.
- For valid shaft channels compute min/max, spread, per-sensor rate and persistent imbalance. Relate opposite regions only when geometry supports it. Use robust smoothing and sustained low rates for stalls.
- Rule-based actions include 90°/180° rotation, movement to a cooler or warmer zone, swapping, leaving in place, checking placement or recalibration. Store action, evidence, reasons, timestamp, uncertainty and benefit when defensible. Require confirmation and use hysteresis and cooldowns. Confirmation updates geometry and records an analysis boundary for comparing before and after.
- Estimate time remaining from target difference divided by robust recent slope. Add smoothed regression and optionally an empirical historical model. Reject unstable/nonpositive slopes, detect rate changes, recalculate on new data, show insufficient data when appropriate and evaluate estimates against completed cooks.
- Alerts cover approach/reach target, high/low ambient, both kinds of imbalance, stalls, probe or gateway disconnect, low battery, ETA change, rotation and completion. Support in-app, browser, push and SMTP, deduplication, thresholds, hysteresis, cooldown, quiet hours, preferences and acknowledgments. Distinguish monitoring loss from temperature emergencies. Keep experimental analysis separate from documented food-safety guidance.

## Calibration, replay and comparison

Calibration selects equipment, setpoint, empty/loaded state and known probe positions, then runs warm-up, stabilization confirmation and timed sampling before saving. Offer 225°F, 250°F, 275°F and custom targets. Report per-location mean, min/max, standard deviation, setpoint deviation, spatial differential, stability and coverage, plus a heat map, zone and placement report and comparisons across configurations.

Replay supports play, pause, scrubbing, 1×/5×/10×/30×/60×, mapped events and synchronized charts, geometry, heat maps, alerts and recommendations. Reconstruct as-of placements using stored events, readings and algorithm versions. History filters equipment, food, size, cook temperatures and times, duration, final readings, rotations, alerts, notes and optional photos. Compare curves, rates, duration, ambient stability, internal spread, rotations and prediction accuracy. Support success labels, preferred configurations and exports.

## Release verification and milestones

- Unit test conversion, parsing, normalization, invalid readings, deduplication, geometry, interpolation, imbalance, recommendations, predictions, alerts and calibration.
- Integration test accounts, household isolation, persistence, adapters, gateway, WebSockets, sessions, reconnect, queries, relay credential handling and notifications. Security checks cover unauthorized subscriptions, token expiry, leaks, CSRF, throttling, input validation, gateway authentication, session fixation and logging.
- Playwright covers account setup through equipment, placement, simulated capture, heat maps, alerts, rotation, finish, replay and comparison. Validate algorithms with known fields, withheld locations, known completion times, one to four probes, impossible placements, stale and out-of-order data.
- Target live updates and typical 12-hour history queries within two seconds under a documented reference deployment. Measure source latency separately. Verify 24-hour sessions, restart recovery, bounded outage buffering, idempotence, background aggregation and graceful 3D rendering on mobile.
- Milestone 0 researches and verifies acquisition. Milestone 1 builds the scaffold, accounts and migrations. Milestone 2 adds device acquisition, persistence and realtime. Milestone 3 delivers dashboard history and geometry. Milestone 4 delivers analytics. Milestone 5 delivers calibration, replay, comparisons and notifications. Milestone 6 hardens security, performance, recovery and deployment.
- Each milestone updates plans and limitations, runs relevant tests and supplies a working state. Release requires verified supported acquisition, complete simulated workflow, persistent sessions, synchronized geometry, honest analytics, multi-account isolation and authenticated remote access.
- Final deliverables include source, migrations, Compose, gateway, scenarios, tests, API and hardware findings, algorithm docs, user and administrator guides, security and limitations, known issues and roadmap. Include backup/restore, secure proxy, Raspberry Pi and workstation setup, and actual capabilities per deployment mode.
