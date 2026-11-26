# ThermIQ development

- Work on a feature branch. Run relevant tests before every conventional commit.
- Prioritize the Wi-Fi BLE relay ingestion path. Defer relay firmware until the hardware is available.
- Cite evidence for vendor telemetry fields and record hardware validation status in the relay documentation.
- Keep credentials, tokens, account identifiers, and raw captures out of Git, browser bundles, and logs.
- Keep simulation visibly labeled at the API and UI. Keep synthetic relay samples out of the hardware feed.
- Preserve stable probe and device IDs, UTC timestamps, explicit Celsius units, and missing values in telemetry.
- Validate partial readings, timeouts, disconnections, and recovery when changing telemetry behavior.
