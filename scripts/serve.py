#!/usr/bin/env python3
"""
One-click local server for Mantiz-EML-Analyzer.

The single cross-platform way to run this app: this exact command works
identically on macOS, Linux, and Windows, using nothing but the Python 3
standard library (no pip installs, no Node).

Usage:
    python3 scripts/serve.py            # start in the background, opens your
                                         # browser, and returns control to
                                         # this terminal immediately
    python3 scripts/serve.py 9000       # same, on a specific port
    python3 scripts/serve.py --stop     # stop the background server
    python3 scripts/serve.py --foreground [port]
                                         # run in *this* terminal instead,
                                         # blocking until Ctrl+C — useful if
                                         # you want to watch the access log
    python3 scripts/serve.py --foreground --open [port]
                                         # same, and also opens your browser
                                         # shortly after the server starts —
                                         # what the double-click launchers
                                         # below use, so nothing ever runs
                                         # detached in the background
    python3 scripts/serve.py --make-launchers
                                         # generates one double-click launcher
                                         # per OS (macOS/Windows/Linux) into
                                         # launchers/, each with this exact
                                         # copy's folder path baked in — copy
                                         # the one for your OS to your Desktop
                                         # (or anywhere) and double-click it
                                         # any time; closing its window stops
                                         # the server, nothing lingers after

(Windows: same commands, just `python` instead of `python3`.)
"""
import http.server
import json
import os
import shlex
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser

DEFAULT_PORT = 8765
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PID_FILE = os.path.join(PROJECT_ROOT, ".server.pid")
LOG_FILE = os.path.join(PROJECT_ROOT, ".server.log")
APP_NAME = "Mantiz-EML-Analyzer"


def find_free_port(start_port):
    port = start_port
    while port < start_port + 200:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    raise RuntimeError("Could not find a free port near {}".format(start_port))


def port_is_open(port, timeout=0.3):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def read_pidfile():
    if not os.path.exists(PID_FILE):
        return None
    try:
        with open(PID_FILE) as f:
            return json.load(f)
    except (ValueError, OSError):
        return None


def is_process_alive(pid):
    if not pid:
        return False
    if os.name == "nt":
        try:
            import ctypes
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if handle:
                ctypes.windll.kernel32.CloseHandle(handle)
                return True
            return False
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def stop_server():
    info = read_pidfile()
    pid = info.get("pid") if info else None
    if not pid or not is_process_alive(pid):
        print("{} is not running.".format(APP_NAME))
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
        return
    print("Stopping {} (PID {})...".format(APP_NAME, pid))
    try:
        if os.name == "nt":
            subprocess.call(["taskkill", "/PID", str(pid), "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)
    print("Stopped.")


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


def run_foreground(requested_port, open_browser=False):
    port = find_free_port(requested_port)
    os.chdir(PROJECT_ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    url = "http://127.0.0.1:{}/index.html".format(port)
    print("=" * 60)
    print(" {} running at: {}".format(APP_NAME, url))
    print(" Serving folder: {}".format(PROJECT_ROOT))
    if open_browser:
        print(" This window IS the running server.")
        print(" Close this window (or press Ctrl+C) to stop it --")
        print(" nothing keeps running in the background afterward.")
    else:
        print(" Press Ctrl+C to stop.")
    print("=" * 60)
    if open_browser:
        # A short delay so the browser doesn't race the socket's first accept().
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping {} server...".format(APP_NAME))
        server.shutdown()


def start_background(requested_port):
    existing = read_pidfile()
    if existing and is_process_alive(existing.get("pid")) and port_is_open(existing.get("port", -1)):
        url = "http://127.0.0.1:{}/index.html".format(existing["port"])
        print("{} is already running at {} (PID {}).".format(APP_NAME, url, existing["pid"]))
        webbrowser.open(url)
        return

    port = find_free_port(requested_port)
    log_handle = open(LOG_FILE, "a")

    popen_kwargs = dict(cwd=PROJECT_ROOT, stdout=log_handle, stderr=log_handle, stdin=subprocess.DEVNULL)
    if os.name == "nt":
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
    else:
        popen_kwargs["start_new_session"] = True  # detach from this terminal's process group

    proc = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--foreground", str(port)], **popen_kwargs)

    with open(PID_FILE, "w") as f:
        json.dump({"pid": proc.pid, "port": port}, f)

    url = "http://127.0.0.1:{}/index.html".format(port)
    for _ in range(50):  # wait up to ~5s for it to actually be listening before opening the browser
        if port_is_open(port):
            break
        time.sleep(0.1)

    stop_cmd = "{} scripts/serve.py --stop".format("python" if os.name == "nt" else "python3")
    print("=" * 60)
    print(" {} started in the background.".format(APP_NAME))
    print(" URL:      {}".format(url))
    print(" PID:      {}".format(proc.pid))
    print(" Log file: {}".format(LOG_FILE))
    print(" Stop it with: {}".format(stop_cmd))
    print("=" * 60)
    webbrowser.open(url)


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
exec "$PYTHON_BIN" scripts/serve.py --foreground --open
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
%PY% scripts\\serve.py --foreground --open
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
exec "$PYTHON_BIN" scripts/serve.py --foreground --open
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
    if "--stop" in args:
        stop_server()
        return
    if "--make-launchers" in args:
        make_launchers()
        return
    foreground = "--foreground" in args
    open_browser_flag = "--open" in args
    args = [a for a in args if a not in ("--foreground", "--open")]

    requested_port = DEFAULT_PORT
    if args:
        try:
            requested_port = int(args[0])
        except ValueError:
            print("Ignoring invalid port argument '{}', using default.".format(args[0]))

    if foreground:
        run_foreground(requested_port, open_browser=open_browser_flag)
    else:
        start_background(requested_port)


if __name__ == "__main__":
    main()
