#!/usr/bin/env python3
"""
One-click local server for Mantiz-EML-Analyzer.

The single cross-platform way to run this app: this exact command works
identically on macOS, Linux, and Windows, using nothing but the Python 3
standard library (no pip installs, no Node).

Usage:
    python3 scripts/serve.py            # always on port 8765 (or whatever's
                                         # in .mantiz-config.json, see below)
                                         # -- opens your browser, and exits by
                                         # itself a few seconds after the app's
                                         # last browser tab closes (Ctrl+C or
                                         # closing the window also stops it).
                                         # If the port's already in use, this
                                         # fails with a message naming the PID
                                         # and the command to stop it, rather
                                         # than silently picking another port
    python3 scripts/serve.py --keep-running
                                         # same, but stays up after the browser
                                         # closes
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
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import folder_locator

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


HEARTBEAT_PATH = "/__mantiz/"
# How long with NO open browser tab at all (every tab said goodbye, or went silent) before the
# server exits by itself. Short for a clean goodbye (still long enough to ride out a page reload,
# which says goodbye and then immediately pings again), long for a tab that just went silent --
# Chrome throttles background tabs' timers to ~once a minute, so silence under that proves nothing.
GOODBYE_GRACE_SECONDS = 8
SILENT_TAB_GRACE_SECONDS = 150


class ClientTracker:
    """
    Tracks which browser tabs currently have the app open, so the server can exit on its own once
    the last one is gone -- the thing people actually expect ("I closed the app, why is the port
    still taken?"). Each tab pings every few seconds with a random id and sends a goodbye on
    pagehide. Never arms until a tab has pinged at least once, so starting the server and opening
    the browser a bit later never shuts it down early. Uses time.monotonic(), which doesn't advance
    while a laptop sleeps, so waking from sleep isn't mistaken for every tab having vanished.
    """
    def __init__(self):
        self._lock = threading.Lock()
        self._clients = {}
        self._armed = False
        self._empty_since = None

    def ping(self, client_id):
        with self._lock:
            self._armed = True
            self._clients[client_id] = time.monotonic()
            self._empty_since = None

    def goodbye(self, client_id):
        with self._lock:
            self._clients.pop(client_id, None)

    def should_exit(self):
        now = time.monotonic()
        with self._lock:
            for cid, last in list(self._clients.items()):
                if now - last > SILENT_TAB_GRACE_SECONDS:
                    del self._clients[cid]
            if not self._armed or self._clients:
                self._empty_since = None
                return False
            if self._empty_since is None:
                self._empty_since = now
            return now - self._empty_since >= GOODBYE_GRACE_SECONDS


TRACKER = ClientTracker()


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """
    This app's own .js/.html/.css files change during development (and
    after every `git pull`), but SimpleHTTPRequestHandler sends no
    Cache-Control header at all — browsers are then free to serve a stale
    cached copy of e.g. a Worker's imported scripts indefinitely. Since
    this is a small local single-user tool, correctness matters far more
    than caching, so every response is explicitly marked non-cacheable.
    Also answers the app's own same-origin heartbeat (see ClientTracker).
    """
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

    def _heartbeat(self):
        """Handles /__mantiz/ping?id=... and /__mantiz/bye?id=...; returns False for any other path."""
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith(HEARTBEAT_PATH):
            return False
        client_id = (urllib.parse.parse_qs(parsed.query).get("id") or [""])[0][:64]
        action = parsed.path[len(HEARTBEAT_PATH):]
        if client_id and action == "ping":
            TRACKER.ping(client_id)
        elif client_id and action == "bye":
            TRACKER.goodbye(client_id)
        self.send_response(204)
        self.end_headers()
        return True

    def do_GET(self):
        if not self._heartbeat():
            super().do_GET()

    # ---- /__mantiz/locate-folder: where on THIS computer does the folder the page just opened live? ----
    LOCATE_PATH = "/__mantiz/locate-folder"
    LOCATE_LOCK = threading.Lock()  # one disk search at a time

    def _same_origin_local(self):
        """True only for a request from this very page: a loopback Host, and an Origin that is exactly that host. Blocks other
        websites (cross-site POST) and DNS-rebinding attempts from reaching the disk search."""
        host = self.headers.get("Host", "")
        name = host.rsplit(":", 1)[0].strip("[]") if not host.startswith("[") else host.split("]")[0].strip("[")
        if name not in ("localhost", "127.0.0.1", "::1"):
            return False
        origin = self.headers.get("Origin", "")
        if origin != "http://" + host:
            return False
        site = self.headers.get("Sec-Fetch-Site")
        return site in (None, "same-origin")

    def _locate_folder(self):
        if not self._same_origin_local():
            self.send_error(403)
            return
        if "application/json" not in self.headers.get("Content-Type", ""):
            self.send_error(415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 1 or length > 65536:
            self.send_error(413 if length > 0 else 400)
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            name, samples, hint = body.get("name"), body.get("samples"), body.get("hint")
        except (ValueError, AttributeError, UnicodeDecodeError):
            self.send_error(400)
            return
        if not self.LOCATE_LOCK.acquire(blocking=False):
            self.send_error(429)
            return
        try:
            result = folder_locator.locate(name, samples, hint if isinstance(hint, str) else None)
        finally:
            self.LOCATE_LOCK.release()
        payload = json.dumps(result).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path == self.LOCATE_PATH:
            self._locate_folder()
        elif not self._heartbeat():
            self.send_error(405)

    def log_message(self, fmt, *args):
        if not self.path.startswith(HEARTBEAT_PATH):
            super().log_message(fmt, *args)


def describe_port_owner(port):
    """Best-effort one-line description of what's listening on `port`, e.g. 'PID 1234 (python3)', plus
    the exact command to stop it. Returns (description, stop_command) or (None, None) -- never raises,
    since this only exists to make an error message more helpful."""
    try:
        if os.name == "nt":
            out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                cols = line.split()
                # Proto, Local, Foreign, State, PID. A listening socket has foreign address 0.0.0.0:0 / [::]:0;
                # that is matched instead of the word "LISTENING", which Windows translates on non-English systems.
                if len(cols) >= 5 and cols[0].upper() == "TCP" and cols[2].endswith(":0") and cols[1].endswith(":" + str(port)):
                    return "PID " + cols[4], "taskkill /PID " + cols[4] + " /F"
        else:
            out = subprocess.run(["lsof", "-nP", "-iTCP:" + str(port), "-sTCP:LISTEN", "-Fpc"],
                                 capture_output=True, text=True, timeout=5).stdout
            pid = name = None
            for line in out.splitlines():
                if line.startswith("p"):
                    pid = line[1:]
                elif line.startswith("c"):
                    name = line[1:]
            if pid:
                return "PID {} ({})".format(pid, name or "unknown"), "kill " + pid
    except (OSError, subprocess.SubprocessError):
        pass
    return None, None


def watch_for_exit(server):
    """Stops `server` once every browser tab has closed (see ClientTracker). Runs in its own thread --
    server.shutdown() has to be called from a different thread than serve_forever()."""
    while True:
        time.sleep(1)
        if TRACKER.should_exit():
            print("\nBrowser closed -- stopping {} server.".format(APP_NAME))
            server.shutdown()
            return


def run(requested_port, auto_exit=True):
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
        owner, stop_cmd = describe_port_owner(port)
        if owner:
            print("It's in use by {}. If that's an old copy of this app, stop it with:".format(owner))
            print("  " + stop_cmd)
        else:
            print("Something else is already using that port. Close it, or run:")
        print("Or use a different port:")
        print("  {} scripts/serve.py <a-different-port>".format("python" if os.name == "nt" else "python3"))
        sys.exit(1)
    url = "http://127.0.0.1:{}/index.html".format(port)
    print("=" * 60)
    print(" {} running at: {}".format(APP_NAME, url))
    print(" Serving folder: {}".format(PROJECT_ROOT))
    if auto_exit:
        print(" Closes itself a few seconds after you close the app's")
        print(" browser tab(s). Ctrl+C (or closing this window) also stops it.")
    else:
        print(" --keep-running: stays up after the browser closes.")
        print(" Close this window (or press Ctrl+C) to stop it.")
    print("=" * 60)
    # A short delay so the browser doesn't race the socket's first accept().
    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    if auto_exit:
        threading.Thread(target=watch_for_exit, args=(server,), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping {} server...".format(APP_NAME))
        server.shutdown()
    server.server_close()


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
    auto_exit = "--keep-running" not in args
    args = [a for a in args if a != "--keep-running"]

    requested_port = configured_port() or DEFAULT_PORT
    if args:
        try:
            requested_port = int(args[0])
        except ValueError:
            print("Ignoring invalid port argument '{}', using default.".format(args[0]))

    run(requested_port, auto_exit)


if __name__ == "__main__":
    main()
