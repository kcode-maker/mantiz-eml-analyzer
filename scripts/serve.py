#!/usr/bin/env python3
"""
One-click local server for Mantiz-EML-Analyzer.

The single cross-platform way to run this app: this exact command works
identically on macOS, Linux, and Windows, using nothing but the Python 3
standard library (no pip installs, no Node).

Usage:
    python3 scripts/serve.py            # always on port 8765 (or whatever's
                                         # in .mantiz-config.json, see below)
                                         # -- opens your browser, and runs
                                         # until you close this terminal
                                         # window or press Ctrl+C -- nothing
                                         # to remember to stop afterward,
                                         # nothing lingers. If the port's
                                         # already in use, this fails with a
                                         # clear message rather than
                                         # silently picking another port
    python3 scripts/serve.py 9000        # same, but on port 9000 for just
                                         # this run (overrides the config
                                         # file below, doesn't change it)
    python3 scripts/serve.py --make-launchers
                                         # generates one double-click launcher
                                         # per OS (macOS/Windows/Linux) into
                                         # launchers/, each with this exact
                                         # copy's folder path baked in -- copy
                                         # the one for your OS to your Desktop
                                         # (or anywhere) and double-click it
                                         # any time

To change the *default* port permanently (so you don't have to pass it
every time), create a `.mantiz-config.json` file next to this repo's
`index.html`:

    { "port": 9000 }

This file is machine-specific (gitignored, like `launchers/`) -- it's your
own local preference, not something the repo ships with. The app's own
Settings page (IDE config) shows which port you're currently running on
and reminds you which file to edit to change it, but can't edit this file
itself -- by the time that page loads in your browser, this script has
already started and bound to a port, so nothing running in the browser can
reach back and change that.

(Windows: same commands, just `python` instead of `python3`.)
"""
import http.server
import json
import os
import sys
import threading
import webbrowser

DEFAULT_PORT = 8765
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_FILE = os.path.join(PROJECT_ROOT, ".mantiz-config.json")
APP_NAME = "Mantiz-EML-Analyzer"


def configured_port():
    """Reads a preferred default port from .mantiz-config.json, if present and valid.
    Returns None (falling back to DEFAULT_PORT) on any error -- a broken/missing
    config file should never stop the app from starting."""
    try:
        with open(CONFIG_FILE) as f:
            data = json.load(f)
        port = int(data.get("port"))
        return port if 1 <= port <= 65535 else None
    except (OSError, ValueError, TypeError):
        return None


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """
    This app's own .js/.html/.css files change during development (and
    after every `git pull`), but SimpleHTTPRequestHandler sends no
    Cache-Control header at all — browsers are then free to serve a stale
    cached copy of e.g. a Worker's imported scripts indefinitely. Since
    this is a small local single-user tool, correctness matters far more
    than caching, so every response is explicitly marked non-cacheable.
    """
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()


def run(requested_port):
    """
    Runs the server in THIS process, in the foreground, and opens the
    browser shortly after. This window IS the running server -- closing it
    (or Ctrl+C) stops the server immediately, and nothing keeps running in
    the background afterward. Deliberately the only mode this script has:
    a background/detached mode needs a separate stop command to remember,
    which defeats the "keep it simple" point of a one-click local server.

    Always binds to exactly `requested_port` (8765 by default) -- never
    silently drifts to a different port if that one's taken, so the app's
    URL is always predictable. If the port really is in use, this fails
    with a clear message instead.
    """
    os.chdir(PROJECT_ROOT)
    port = requested_port
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    except OSError as e:
        print("Could not start on port {}: {}".format(port, e))
        print("Something else is already using that port. Close it, or run:")
        print("  {} scripts/serve.py <a-different-port>".format("python" if os.name == "nt" else "python3"))
        sys.exit(1)
    url = "http://127.0.0.1:{}/index.html".format(port)
    print("=" * 60)
    print(" {} running at: {}".format(APP_NAME, url))
    print(" Serving folder: {}".format(PROJECT_ROOT))
    print(" This window IS the running server.")
    print(" Close this window (or press Ctrl+C) to stop it --")
    print(" nothing keeps running in the background afterward.")
    print("=" * 60)
    # A short delay so the browser doesn't race the socket's first accept().
    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping {} server...".format(APP_NAME))
        server.shutdown()


MAC_LAUNCHER_TEMPLATE = """#!/usr/bin/env bash
# {app_name} -- double-click launcher, generated for this machine's copy of
# the app (points at: {project_root}).
#
# This window IS the running server. Close it (or press Ctrl+C) to stop --
# nothing keeps running in the background afterward. Safe to move anywhere,
# e.g. onto your Desktop; re-run "python3 scripts/serve.py --make-launchers"
# from the app folder if you ever move the app itself and need a new one.
set -euo pipefail
cd {project_root_quoted}
PYTHON_BIN="python3"
command -v python3 >/dev/null 2>&1 || PYTHON_BIN="python"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3 was not found on PATH. Install it from https://www.python.org/downloads/ and try again."
  read -n 1 -s -r -p "Press any key to close this window..."
  echo
  exit 1
fi
exec "$PYTHON_BIN" scripts/serve.py
"""

WINDOWS_LAUNCHER_TEMPLATE = """@echo off
REM {app_name} -- double-click launcher, generated for this machine's copy of
REM the app (points at: {project_root}).
REM
REM This window IS the running server. Close it (or press Ctrl+C) to stop --
REM nothing keeps running in the background afterward. Safe to move anywhere,
REM e.g. onto your Desktop; re-run "python scripts\\serve.py --make-launchers"
REM from the app folder if you ever move the app itself and need a new one.
cd /d "{project_root}"
where python >nul 2>nul
if %errorlevel%==0 (
  set PY=python
) else (
  where python3 >nul 2>nul
  if %errorlevel%==0 (
    set PY=python3
  ) else (
    echo Python 3 was not found on PATH. Install it from https://www.python.org/downloads/ and try again.
    pause
    exit /b 1
  )
)
%PY% scripts\\serve.py
"""

LINUX_SCRIPT_TEMPLATE = """#!/usr/bin/env bash
# {app_name} -- double-click launcher, generated for this machine's copy of
# the app (points at: {project_root}).
#
# This window IS the running server. Close it (or press Ctrl+C) to stop --
# nothing keeps running in the background afterward.
set -euo pipefail
cd {project_root_quoted}
PYTHON_BIN="python3"
command -v python3 >/dev/null 2>&1 || PYTHON_BIN="python"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3 was not found on PATH. Install it from https://www.python.org/downloads/ and try again."
  read -n 1 -s -r -p "Press any key to close this window..."
  echo
  exit 1
fi
exec "$PYTHON_BIN" scripts/serve.py
"""

LINUX_DESKTOP_TEMPLATE = """[Desktop Entry]
Type=Application
Name={app_name}
Comment=Double-click to open {app_name} in your browser. Close the terminal window to stop it -- nothing keeps running in the background.
Exec={script_path_quoted}
Terminal=true
Icon=utilities-terminal
Categories=Utility;
"""


def make_launchers():
    """
    Generates one double-click launcher per OS into launchers/, each with
    THIS copy's absolute folder path baked in, so the generated file can be
    moved anywhere (a Desktop, say) and still find the right app folder.
    Not committed to git (machine-specific paths) -- see .gitignore.
    """
    import shlex

    launchers_dir = os.path.join(PROJECT_ROOT, "launchers")
    os.makedirs(launchers_dir, exist_ok=True)
    quoted_root = shlex.quote(PROJECT_ROOT)

    mac_path = os.path.join(launchers_dir, "{}.command".format(APP_NAME))
    with open(mac_path, "w") as f:
        f.write(MAC_LAUNCHER_TEMPLATE.format(app_name=APP_NAME, project_root=PROJECT_ROOT, project_root_quoted=quoted_root))
    os.chmod(mac_path, 0o755)

    win_path = os.path.join(launchers_dir, "{}.bat".format(APP_NAME))
    with open(win_path, "w") as f:
        f.write(WINDOWS_LAUNCHER_TEMPLATE.format(app_name=APP_NAME, project_root=PROJECT_ROOT))

    linux_script_path = os.path.join(launchers_dir, "{}-linux.sh".format(APP_NAME))
    with open(linux_script_path, "w") as f:
        f.write(LINUX_SCRIPT_TEMPLATE.format(app_name=APP_NAME, project_root=PROJECT_ROOT, project_root_quoted=quoted_root))
    os.chmod(linux_script_path, 0o755)

    linux_desktop_path = os.path.join(launchers_dir, "{}.desktop".format(APP_NAME))
    with open(linux_desktop_path, "w") as f:
        f.write(LINUX_DESKTOP_TEMPLATE.format(app_name=APP_NAME, script_path_quoted=shlex.quote(linux_script_path)))
    os.chmod(linux_desktop_path, 0o755)

    print("=" * 60)
    print(" Desktop launchers created in: {}".format(launchers_dir))
    print("   macOS:   {}".format(mac_path))
    print("   Windows: {}".format(win_path))
    print("   Linux:   {}  (needs {} alongside it, or edit its Exec= path".format(linux_desktop_path, os.path.basename(linux_script_path)))
    print("            if you move just the .desktop file elsewhere)")
    print()
    print(" Copy the one for your OS to your Desktop (or anywhere) and")
    print(" double-click it any time. Each one runs the server in its own")
    print(" window only -- closing that window stops it, nothing lingers")
    print(" in the background.")
    print("=" * 60)


def main():
    args = sys.argv[1:]
    if "--make-launchers" in args:
        make_launchers()
        return
    if "--stop" in args:
        print("Nothing to stop -- this script no longer runs in the background.")
        print("Just close its terminal window (or press Ctrl+C) to stop it.")
        return
    # --foreground/--open are accepted (but no longer needed) for anyone with an
    # older double-click launcher lying around that still passes them.
    args = [a for a in args if a not in ("--foreground", "--open")]

    requested_port = configured_port() or DEFAULT_PORT
    if args:
        try:
            requested_port = int(args[0])
        except ValueError:
            print("Ignoring invalid port argument '{}', using default.".format(args[0]))

    run(requested_port)


if __name__ == "__main__":
    main()
