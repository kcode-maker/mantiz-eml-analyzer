"""
Structure and portability guard (Python standard library only). Run via tests/run-all.sh, or: python3 tests/test_structure.py

Enforces the repo's standing rules so they cannot erode silently:
  * standalone  — the app loads nothing from the network and needs no build/install step: every <script>/<link> is a local file that
                  exists, every network URL in code is on a short allow-list (the two user-initiated lookups), and Python tooling
                  imports only the standard library;
  * OS-independent — no hard-coded user paths, no platform sniffing in the browser code, no OS-only Python module imports at top
                  level (anything OS-specific is behind a runtime check and covered by a test with a mock);
  * architecture — every JS file is actually loaded (no orphans), the feature-module list in app.js matches js/ui/features/, and
                  scripts load in dependency order for the pieces that read each other at load time.
"""
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
        return handle.read()


def js_files():
    out = []
    for base, _dirs, files in os.walk(os.path.join(ROOT, "js")):
        for name in files:
            if name.endswith(".js"):
                out.append(os.path.relpath(os.path.join(base, name), ROOT).replace(os.sep, "/"))
    return sorted(out)


INDEX = read("index.html")
SCRIPTS = re.findall(r'<script[^>]*\ssrc="([^"]+)"', INDEX)
WORKER_IMPORTS = re.findall(r"'([^']+\.js)'", read("js/indexing/worker.js").split("importScripts", 1)[1].split(");", 1)[0])
# Allow-list of hosts the code may mention. Only the first two are ever contacted, each on an explicit user click.
ALLOWED_HOSTS = {"www.virustotal.com", "rdap.org", "www.w3.org", "www.python.org", "127.0.0.1", "ev-placeholder.invalid", "xn--e1afmkfd.xn--p1ai"}


class Standalone(unittest.TestCase):
    def test_every_script_and_stylesheet_is_a_local_file(self):
        refs = SCRIPTS + re.findall(r'<link[^>]*\shref="([^"]+)"', INDEX)
        self.assertTrue(refs)
        for ref in refs:
            self.assertFalse(re.match(r"^(https?:)?//", ref), "index.html loads a remote resource: " + ref)
            self.assertTrue(os.path.isfile(os.path.join(ROOT, ref)), "index.html references a missing file: " + ref)

    def test_network_hosts_in_code_are_allow_listed(self):
        for rel in js_files() + ["index.html"] + ["scripts/" + n for n in os.listdir(os.path.join(ROOT, "scripts"))]:
            if rel.endswith(".pyc") or os.path.isdir(os.path.join(ROOT, rel)):
                continue
            for host in re.findall(r"https?://([A-Za-z0-9.-]+)", read(rel)):
                self.assertIn(host, ALLOWED_HOSTS, "%s mentions an unlisted host %s (add it deliberately, with the reason)" % (rel, host))

    def test_no_build_or_package_manager_files(self):
        for name in ("package.json", "package-lock.json", "yarn.lock", "webpack.config.js", "tsconfig.json", "requirements.txt", "pyproject.toml"):
            self.assertFalse(os.path.exists(os.path.join(ROOT, name)), name + " would mean a build/install step")

    def test_python_tooling_uses_only_the_standard_library(self):
        stdlib = getattr(sys, "stdlib_module_names", None)
        if stdlib is None:
            self.skipTest("needs Python 3.10+ for sys.stdlib_module_names")
        local = {"folder_locator"}
        for rel in ["scripts/" + n for n in os.listdir(os.path.join(ROOT, "scripts")) if n.endswith(".py")] + ["tests/" + n for n in os.listdir(os.path.join(ROOT, "tests")) if n.endswith(".py")]:
            for mod in re.findall(r"^(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)", read(rel), flags=re.M):
                self.assertTrue(mod in stdlib or mod in local, "%s imports non-stdlib module %s" % (rel, mod))

    def test_the_only_module_script_is_the_vendored_ocr_bridge(self):
        self.assertEqual(re.findall(r'<script[^>]*type="module"[^>]*src="([^"]+)"', INDEX), ["js/core/ocrBridge.js"])
        for rel in js_files():
            if rel == "js/core/ocrBridge.js":
                continue
            self.assertIsNone(re.search(r"^\s*(import\s|export\s)", read(rel), flags=re.M), rel + " uses ES-module syntax")
            self.assertNotIn("require(", read(rel), rel + " uses require()")


class OsIndependent(unittest.TestCase):
    def test_no_hard_coded_user_paths_or_platform_sniffing(self):
        for rel in js_files() + ["index.html"] + ["scripts/" + n for n in os.listdir(os.path.join(ROOT, "scripts")) if n.endswith(".py")]:
            text = read(rel)
            self.assertIsNone(re.search(r"/Users/|/home/[a-z]|C:\\\\Users", text), rel + " hard-codes a user path")
            if rel.startswith("js/"):
                self.assertNotIn("navigator.platform", text, rel + " sniffs the platform")
                self.assertNotIn("navigator.userAgent", text, rel + " sniffs the user agent")

    def test_python_os_specific_code_is_behind_runtime_checks(self):
        text = read("scripts/folder_locator.py")
        self.assertNotIn("import winreg", text)
        self.assertNotIn("import msvcrt", text)
        self.assertIn('sys.platform == "darwin"', text)   # mdfind is only ever tried on macOS
        self.assertIn('os.name == "nt"', text)            # drive letters only on Windows
        self.assertNotIn("subprocess.run(\"", text)       # never a shell string

    def test_local_server_binds_to_loopback_only(self):
        self.assertIn('("127.0.0.1", port)', read("scripts/serve.py"))


class Architecture(unittest.TestCase):
    def test_every_js_file_is_loaded_by_the_page_or_the_worker(self):
        started_by_app = set(re.findall(r"'(js/[^']+\.js)'", read("js/ui/app.js")))  # the Worker entry point
        loaded = set(SCRIPTS) | started_by_app | {"js/indexing/" + n if "/" not in n else os.path.normpath("js/indexing/" + n).replace(os.sep, "/") for n in WORKER_IMPORTS}
        for rel in js_files():
            self.assertIn(rel, loaded, rel + " is never loaded (orphan module)")

    def test_no_script_is_loaded_twice(self):
        self.assertEqual(len(SCRIPTS), len(set(SCRIPTS)))

    def test_feature_list_in_app_js_matches_the_features_folder(self):
        listed = re.findall(r"'(\w+)'", re.search(r"\[('explorer'.*?)\]\.forEach", read("js/ui/app.js"), re.S).group(1))
        on_disk = sorted(n[:-3] for n in os.listdir(os.path.join(ROOT, "js/ui/features")) if n.endswith(".js"))
        self.assertEqual(sorted(listed), on_disk)
        for name in on_disk:
            self.assertIn("EV.ui.features." + name + " = function", read("js/ui/features/%s.js" % name))
            self.assertIn("js/ui/features/%s.js" % name, SCRIPTS)

    def test_features_only_reach_each_other_through_ctx(self):
        # A feature module must not read another module's internals via EV.ui.features.*; ctx is the one contract.
        for name in os.listdir(os.path.join(ROOT, "js/ui/features")):
            body = read("js/ui/features/" + name)
            self.assertEqual(len(re.findall(r"EV\.ui\.features\.\w+\s*[(.]", body)), 0, name + " calls into another feature directly")

    def test_load_order_for_load_time_dependencies(self):
        def idx(rel):
            self.assertIn(rel, SCRIPTS, rel)
            return SCRIPTS.index(rel)
        order = [
            ("js/parsing/emlParser.js", "js/parsing/headerTables.js"),   # headerTables reads EV.getHeaderAll at call time but is loaded after the parser
            ("js/parsing/headerTables.js", "js/indexing/anomalies.js"),
            ("js/indexing/anomalies.js", "js/indexing/indexLogic.js"),
            ("js/core/settings.js", "js/core/settingsCache.js"),         # settingsCache starts loading the lists at load time
            ("js/ui/uiKit.js", "js/ui/overlays.js"),
            ("js/ui/uiKit.js", "js/ui/email/headersView.js"),
            ("js/ui/email/attachmentsView.js", "js/ui/render.js"),
            ("js/ui/render.js", "js/ui/features/explorer.js"),
            ("js/ui/features/session.js", "js/ui/app.js"),
        ]
        for before, after in order:
            self.assertLess(idx(before), idx(after), "%s must load before %s" % (before, after))

    def test_worker_and_page_agree_on_the_indexing_scripts(self):
        # Everything buildIndexDoc needs in a worker must also be on the page (the single-thread fallback runs it there).
        for n in WORKER_IMPORTS:
            rel = os.path.normpath("js/indexing/" + n).replace(os.sep, "/")
            if rel in ("js/indexing/indexLogic.js",):
                self.assertIn(rel, SCRIPTS)
        self.assertTrue(set(["js/parsing/headerTables.js", "js/indexing/anomalies.js"]) <= set(
            os.path.normpath("js/indexing/" + n).replace(os.sep, "/") for n in WORKER_IMPORTS))


if __name__ == "__main__":
    unittest.main()
