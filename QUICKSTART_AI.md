# ThermIQ quickstart for Claude Code or Codex

Open Claude Code or Codex on the computer that will run ThermIQ, then paste the
entire prompt below. For firmware flashing, the computer running the upload
command must have USB access to the board. If your assistant runs in a cloud
workspace, keep it open for guidance and run the machine-specific steps in your
local terminal.

````text
Help me install, run, and customize ThermIQ on my computer. The upstream
repository is https://github.com/keonr/ThermIQ. I want a working local dashboard
and, if I have the hardware, a Chef iQ CQ60 relay using the M5Stack ATOM Lite
(C008, original ESP32). Work through one checkpoint at a time. Execute authorized
commands when you can access my machine. If a step needs my USB connection,
permission, or credentials, give me the exact next action and resume from the
result. Distinguish build results, simulated data, and physical probe readings.

## 1. Get my own editable copy

- Check the OS, CPU architecture, working directory, Git installation, and
  whether this shell actually runs on my computer. Ask where to put the checkout
  if I have not chosen a folder. Inspect any existing checkout before changing it.
- If I have a GitHub fork, verify its owner and URL, then clone that fork. If I
  want to publish modifications and do not have a fork, guide me through forking
  keonr/ThermIQ on GitHub and cloning my fork. Use my fork as origin and the
  public source as upstream. If I only want to try the app, clone the public
  source into a local folder. Check git status and git remote -v before edits.
- Read the checkout's AGENTS.md, README.md, docs/SPECIFICATION.md,
  docs/BLE_RELAY.md, gateway/ble/README.md, docker-compose.yml,
  apps/web/nginx.conf, and gateway/ble/platformio.ini. Treat these files as the
  source of truth for the checked-out version.
- Check for prerequisites before installing anything. The Compose path needs
  Git, a running Docker engine and Docker Compose v2. Local development needs
  Python 3.12+ and Node.js 22.18+ or 24 with npm. The relay path also needs
  PlatformIO Core (pio), Caddy, a USB data cable, and 2.4 GHz Wi-Fi. Install
  missing tools using the OS package manager or official installers, with my
  approval where required. On macOS, Docker Desktop supplies the engine and
  Compose, whereas installing the Docker CLI alone does not start an engine.
  Verify docker info, docker compose version, python3 --version, node --version,
  npm --version, pio --version, and caddy version as relevant.

## 2. Prove the dashboard works with simulated data

- From the repository root, inspect .env.example and preserve any existing
  ignored .env. Default simulation uses THERMIQ_TELEMETRY_SOURCE=simulator.
  Run docker compose config --quiet and docker compose up -d --build --wait.
- Open http://127.0.0.1:8080 on the host. Confirm /api/health reports simulator,
  and /api/v1/telemetry shows four simulated probes. Check that the readings
  update and try starting, finishing, and replaying a short cook.
- The editable dashboard defaults to loopback port 8080. The optional read-only
  viewer is on loopback port 8081. API port 8000 is internal to Compose. Keep
  the dashboard and these ports local during setup. Preserve the named
  relay-data volume when restarting or rebuilding.
- If I only want the simulator, stop before firmware setup. If I want to scan
  using my Mac itself, read the direct Bluetooth instructions in docs/BLE_RELAY.md.
  That path runs the API on the host with Bleak and needs no relay or Caddy.
- For code changes without Compose, use the README's separate API venv and
  npm ci / npm run dev instructions. Check the configured Vite API proxy
  before changing ports.

## 3. Set up the receiver and local HTTPS routing

- In the ignored root .env, set THERMIQ_TELEMETRY_SOURCE=ble and create a strong
  THERMIQ_RELAY_TOKEN if one does not already exist. For example, generate 32
  random bytes with openssl rand -hex 32. Put the same value in the ignored
  firmware config later. Keep Wi-Fi passwords, relay tokens, private keys, and
  private hostnames out of Git, tool output, and chat. Let me enter credentials
  locally. Check that both config files are ignored with git check-ignore.
- Restart Compose with docker compose up -d --wait. Verify
  http://127.0.0.1:8080/api/health reports ble. A waiting-for-readings state
  before the first valid relay upload is expected.
- Choose a hostname the relay can resolve on the same LAN. On macOS, get the
  Bonjour name with scutil --get LocalHostName and append .local. Check its
  IPv4 resolution with dns-sd -G v4 NAME.local. Bonjour needs multicast on the
  local link. If discovery fails, check guest isolation and use an existing
  operator-controlled LAN DNS hostname where available. Use the same name in
  Caddy, the certificate, and the firmware URL.
- Put a local Caddyfile outside the checkout or in an explicitly ignored local
  directory. The following is an example. Replace HOSTNAME.local with my
  actual hostname. Merge it with any existing Caddy config and preserve other
  sites. If there is a global options block, merge these options into it.

  ~~~caddyfile
  {
      skip_install_trust
      auto_https disable_redirects
  }

  https://HOSTNAME.local:8443 {
      tls internal
      @relay {
          method POST
          path /api/v1/relay/readings
      }
      handle @relay {
          reverse_proxy 127.0.0.1:8080
      }
      handle {
          respond 404
      }
  }
  ~~~

- Validate with caddy validate --config Caddyfile --adapter caddyfile. If
  Caddy is already running, reload its configuration. Otherwise start it with
  caddy run --config Caddyfile --adapter caddyfile in a separate terminal.
  Keep it running. Allow LAN access to the relay proxy on 8443 through the host
  firewall where needed. Local setup requires no router port forwarding.
- Use caddy environ as the same user and service environment running Caddy.
  Find caddy.AppDataDir and locate pki/authorities/local/root.crt beneath it.
  Test with curl --cacert /path/to/root.crt -i -X POST
  https://HOSTNAME.local:8443/api/v1/relay/readings. An unauthenticated POST
  returning HTTP 401 confirms that hostname, HTTPS, proxy, and receiver work
  together from the test client. It does not verify the board's own connection.
  The firmware needs the public root certificate PEM. Keep root.key on the host.

## 4. Build and flash the ATOM Lite

- Plug in the original M5Stack ATOM Lite (C008) with a USB data cable. Use
  pio device list to discover the actual port. Compare the list before and
  after connecting if uncertain. Ask me to confirm the board and port before
  flashing because an upload replaces the board's current firmware. Close any
  existing serial monitor before uploading.
- Work in gateway/ble. Build the USB bench firmware with
  pio run -e m5stack-atom. Flash it with
  pio run -e m5stack-atom -t upload --upload-port PORT.
  Open pio device monitor --port PORT --baud 115200. Wake the probes near the
  board, look for distinct probe IDs and Celsius readings, and verify their
  identities against the physical probes before using the Wi-Fi build.
- Copy include/relay_config.example.hpp to include/relay_config.hpp if the
  ignored local header does not exist. Set WIFI_SSID, WIFI_PASSWORD,
  RELAY_URL, RELAY_TOKEN, and RELAY_CA_PEM. Use the full HTTPS URL including
  /api/v1/relay/readings and paste the entire BEGIN/END CERTIFICATE block into
  the existing raw string. Keep the configured binary private because it
  contains the Wi-Fi credentials and token.
- Compile with pio run -e m5stack-atom-relay. Flash with
  pio run -e m5stack-atom-relay -t upload --upload-port PORT. Reopen the serial
  monitor at 115200 baud and reset the board if you missed the startup line.
  If upload loses the serial connection, confirm the cable and port, then try
  setting upload_speed = 115200 in a temporary copy of platformio.ini and pass
  it using pio run --project-conf FILE. If the monitor reports a port lock,
  close the existing monitor before retrying.
- Leave the receiver and Caddy running. Wake a probe and look for scanning,
  followed by uploaded with HTTP 200. Confirm the dashboard shows the relay's
  live probe data and identifies each physical probe. HTTP 401 points to a
  token mismatch or a receiver that has not loaded the new .env. A Bonjour
  lookup error points to hostname or multicast reachability. A negative upload
  result warrants checking Wi-Fi, clock sync, TLS trust, and routing. If it
  only says scanning, verify the probes are awake and use the bench target
  to check advertisements. Keep certificate verification enabled.

## 5. Help me use and develop the app

- Explain the data path: CQ60 protocol 5.x BLE advertisements → ATOM Lite
  decoder and short RAM queue → authenticated HTTPS POST → FastAPI relay
  storage → dashboard and cook snapshots. The queue clears on a board reset.
- Use apps/web/src for React/TypeScript dashboard, cook controls, charts and
  layouts. Use apps/api for the FastAPI routes, acquisition modes, SQLite
  storage, and session logic. Use gateway/ble for ESP32 firmware. Explain
  which files are involved when I ask for a change, and check existing code
  before claiming a feature or device compatibility.
- Help me save equipment dimensions, place probes, record and replay a cook,
  and interpret heat maps and alerts. For an incident, report which stage
  failed, the exact evidence, and the next check. Separate recorded values
  from estimated heat maps and simulated readings.
- Create a feature branch in my fork for requested changes. Preserve existing
  local edits and ignored configuration. Test from apps/api with
  python -m unittest -v after installing requirements-dev.txt. From apps/web,
  run npm test and npm run build, and run the Chromium end-to-end test when
  appropriate. For firmware changes, build the relevant PlatformIO targets
  and run the host-side fixtures described in gateway/ble/README.md.
- Show git diff and status, make focused conventional commits, and push only
  to my fork when I ask. If I request a PR, confirm its target. Never commit
  private deployment config, data volumes, compiled credential-bearing
  firmware, or generated captures. Summarize service URLs, start and stop
  commands, verification results, and any remaining physical test.
````
