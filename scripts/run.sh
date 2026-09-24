#!/usr/bin/env bash
# Double-click-friendly wrapper (macOS/Linux) around the real cross-platform
# launcher, scripts/serve.py. Requires only Python 3.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PYTHON_BIN="python3"
command -v python3 >/dev/null 2>&1 || PYTHON_BIN="python"
command -v "$PYTHON_BIN" >/dev/null 2>&1 || {
  echo "Python 3 was not found on PATH. Install it from https://www.python.org/downloads/ and try again." >&2
  exit 1
}

exec "$PYTHON_BIN" serve.py "$@"
