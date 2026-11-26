#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
api="$repo/apps/api"
web="$repo/apps/web"
python=${THERMIQ_PYTHON:-python3}
api_port=${THERMIQ_API_PORT:-8000}
web_port=${THERMIQ_WEB_PORT:-5173}

if ! "$python" -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then
  echo "ThermIQ needs Python 3.12 or later. Set THERMIQ_PYTHON to its executable." >&2
  exit 1
fi
if ! command -v npm >/dev/null; then
  echo "Install Node.js with npm before running ThermIQ." >&2
  exit 1
fi

if [[ ! -x "$api/.venv/bin/python" ]]; then
  "$python" -m venv "$api/.venv"
fi
"$api/.venv/bin/python" -m pip install -r "$api/requirements-ble.txt"
if [[ ! -x "$web/node_modules/.bin/vite" ]]; then
  npm --prefix "$web" ci
fi

(
  cd "$api"
  THERMIQ_TELEMETRY_SOURCE=ble_direct exec .venv/bin/python -m uvicorn main:app \
    --host 127.0.0.1 --port "$api_port"
) &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"$api/.venv/bin/python" - "$api_port" "$api_pid" <<'PY'
import json
import os
import sys
import time
import urllib.request

port, pid = map(int, sys.argv[1:])
for _ in range(50):
    try:
        os.kill(pid, 0)
    except OSError:
        break
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as response:
            if json.load(response)["telemetry_source"] == "ble_direct":
                break
    except OSError:
        pass
    time.sleep(0.2)
else:
    sys.exit("ThermIQ's direct Bluetooth API did not start.")
try:
    os.kill(pid, 0)
except OSError:
    sys.exit("ThermIQ's direct Bluetooth API exited. Check the port and startup logs.")
PY

cd "$web"
THERMIQ_DEV_API_URL="http://127.0.0.1:$api_port" npm run dev -- \
  --host 127.0.0.1 --port "$web_port" --strictPort
