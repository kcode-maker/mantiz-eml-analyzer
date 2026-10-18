"""
folder_locator.py -- finds where on THIS computer a folder the user picked in the browser really lives.

Why: no browser tells a web page the real location of a picked folder (only its name and the paths inside it). This app
is served by scripts/serve.py, a local process that CAN see the disk, so the page sends it the folder's name plus a
small fingerprint (a few relative file paths with their sizes) and gets the full path back. Nothing is guessed: a folder
is only accepted when every fingerprinted file exists inside it with exactly the same size, so a different folder that
merely shares the name is never reported. Read-only (only stat/listdir/mdfind); standard library only; bounded in time.

    locate(name, samples, hint=None, budget=6.0) -> {"path": str | None, "matches": int}
        samples = [{"p": "sub/a.eml", "s": 1234}, ...]   (relative path with "/" separators, size in bytes)
        hint    = a path to try first (the one found last time)
"""
import os
import subprocess
import sys
import time

MAX_SAMPLES = 20
SKIP_DIRS = {"node_modules", "__pycache__", "$recycle.bin", "system volume information", "windows", "program files",
             "program files (x86)", "programdata", "proc", "sys", "dev", "appdata", ".git"}


def _clean_samples(samples):
    out = []
    for item in (samples or [])[:MAX_SAMPLES]:
        try:
            rel, size = str(item["p"]), int(item["s"])
        except (KeyError, TypeError, ValueError):
            continue
        parts = rel.split("/")
        if size < 0 or not rel or rel.startswith("/") or "\\" in rel or ".." in parts or "" in parts or ":" in parts[0]:
            continue
        out.append((parts, size))
    return out


def _matches(directory, samples):
    """True when EVERY fingerprinted file exists in `directory` with exactly the recorded size."""
    if not samples or not os.path.isdir(directory):
        return False
    for parts, size in samples:
        try:
            full = os.path.join(directory, *parts)
            if not os.path.isfile(full) or os.path.getsize(full) != size:
                return False
        except OSError:
            return False
    return True


def _search_roots():
    home = os.path.expanduser("~")
    roots = [(home, 8)]
    if sys.platform == "darwin":
        for base in ("/Volumes",):
            # "/Volumes/Macintosh HD" is a symlink to "/": walking the whole system volume is never wanted
            roots += [(os.path.join(base, d), 5) for d in _listdir(base) if os.path.realpath(os.path.join(base, d)) != "/"]
    elif os.name == "nt":
        for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
            drive = letter + ":\\"
            if os.path.isdir(drive):
                roots.append((drive, 4))
    else:
        for base in ("/media", "/mnt", "/run/media"):
            roots += [(os.path.join(base, d), 5) for d in _listdir(base)]
    return roots


def _listdir(path):
    try:
        return sorted(os.listdir(path))
    except OSError:
        return []


def _spotlight(name, root, timeout):
    """macOS only: Spotlight finds folders by name almost instantly. Returns [] when unavailable or disabled."""
    if sys.platform != "darwin":
        return []
    query = 'kMDItemFSName == "{}"c && kMDItemContentType == "public.folder"'.format(name.replace("\\", "\\\\").replace('"', '\\"'))
    try:
        res = subprocess.run(["mdfind", "-onlyin", root, query], capture_output=True, text=True, timeout=timeout)
        return [line for line in res.stdout.splitlines() if line]
    except (OSError, subprocess.SubprocessError):
        return []


def _walk(name, root, max_depth, deadline):
    """Bounded breadth-limited walk for directories called `name` (case-insensitive)."""
    wanted = name.lower()
    stack = [(root, 0)]
    while stack and time.monotonic() < deadline:
        current, depth = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    if time.monotonic() >= deadline:
                        return
                    try:
                        if not entry.is_dir(follow_symlinks=False):
                            continue
                    except OSError:
                        continue
                    lower = entry.name.lower()
                    if lower == wanted:
                        yield entry.path
                    if depth + 1 < max_depth and not entry.name.startswith(".") and lower not in SKIP_DIRS \
                            and not (sys.platform == "darwin" and lower == "library" and current == root):
                        stack.append((entry.path, depth + 1))
        except OSError:
            continue


def locate(name, samples, hint=None, budget=6.0):
    name = str(name or "")
    if not name or "/" in name or "\\" in name or name in (".", "..") or len(name) > 255:
        return {"path": None, "matches": 0}
    fingerprint = _clean_samples(samples)
    if not fingerprint:
        return {"path": None, "matches": 0}
    if hint and os.path.basename(str(hint).rstrip("/\\")).lower() == name.lower() and _matches(str(hint), fingerprint):
        return {"path": str(hint), "matches": 1}

    deadline = time.monotonic() + max(0.5, float(budget))
    found, seen = [], set()

    def consider(path):
        key = os.path.normcase(os.path.abspath(path))
        if key in seen:
            return
        seen.add(key)
        if _matches(path, fingerprint):
            found.append(os.path.abspath(path))

    roots = _search_roots()
    for root, _depth in roots:
        for path in _spotlight(name, root, max(0.5, min(3.0, deadline - time.monotonic()))):
            consider(path)
    if not found:
        for root, depth in roots:
            if time.monotonic() >= deadline:
                break
            for path in _walk(name, root, depth, deadline):
                consider(path)
                if found:
                    break
            if found:
                break
    if not found:
        return {"path": None, "matches": 0}
    # Several identical copies (same name AND same files): any is a correct answer for display; prefer the shortest path.
    found.sort(key=lambda p: (len(p), p))
    return {"path": found[0], "matches": len(found)}
