"""Tests for scripts/folder_locator.py. Run via tests/run-all.sh, or: python3 tests/test_folder_locator.py"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import folder_locator as fl  # noqa: E402


def make(root, files):
    for rel, content in files.items():
        full = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as handle:
            handle.write(content)


class LocateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = os.path.realpath(self.tmp.name)
        self.files = {"a.eml": b"hello world", "sub/b.eml": b"second file!!"}
        self.sample = [{"p": "a.eml", "s": 11}, {"p": "sub/b.eml", "s": 13}]
        self.real = os.path.join(self.base, "work", "mail-box")
        make(self.real, self.files)
        fl._search_roots = lambda: [(self.base, 6)]  # search only the temp tree

    def tearDown(self):
        self.tmp.cleanup()

    def test_finds_the_folder_by_name_and_fingerprint(self):
        res = fl.locate("mail-box", self.sample)
        self.assertEqual(res["path"], self.real)
        self.assertEqual(res["matches"], 1)

    def test_same_name_but_different_content_is_rejected(self):
        decoy = os.path.join(self.base, "other", "mail-box")
        make(decoy, {"a.eml": b"different length content"})
        res = fl.locate("mail-box", self.sample)
        self.assertEqual(res["path"], self.real)  # the decoy is never reported

    def test_only_a_decoy_exists_gives_no_path(self):
        fl_root = os.path.join(self.base, "x")
        make(os.path.join(fl_root, "solo"), {"a.eml": b"nope"})
        self.assertIsNone(fl.locate("solo", self.sample)["path"])

    def test_wrong_size_in_one_file_rejects(self):
        res = fl.locate("mail-box", [{"p": "a.eml", "s": 11}, {"p": "sub/b.eml", "s": 14}])
        self.assertIsNone(res["path"])

    def test_hint_is_verified_first(self):
        self.assertEqual(fl.locate("mail-box", self.sample, hint=self.real)["path"], self.real)
        self.assertEqual(fl.locate("mail-box", self.sample, hint=os.path.join(self.base, "gone", "mail-box"))["path"], self.real)

    def test_case_insensitive_folder_name(self):
        self.assertEqual(fl.locate("MAIL-BOX", self.sample)["path"], self.real)

    def test_several_identical_copies_still_returns_a_verified_one(self):
        copy = os.path.join(self.base, "work", "backups", "2024", "mail-box")
        make(copy, self.files)
        res = fl.locate("mail-box", self.sample)
        self.assertIn(res["path"], (self.real, copy))
        self.assertGreaterEqual(res["matches"], 1)

    def test_hostile_input_is_refused(self):
        for bad in ("", ".", "..", "a/b", "a\\b", "x" * 300):
            self.assertIsNone(fl.locate(bad, self.sample)["path"])
        self.assertIsNone(fl.locate("mail-box", [])["path"])
        evil = [{"p": "../../etc/passwd", "s": 1}, {"p": "/etc/passwd", "s": 1}, {"p": "a\\b", "s": 1}, {"p": "C:/x", "s": 1}, {"p": "", "s": 1}, {"p": "a.eml", "s": -1}, {"s": 1}, "junk"]
        self.assertEqual(fl._clean_samples(evil), [])
        self.assertIsNone(fl.locate("mail-box", evil)["path"])

    def test_sample_count_is_bounded(self):
        many = [{"p": "f%d" % i, "s": 1} for i in range(100)]
        self.assertEqual(len(fl._clean_samples(many)), fl.MAX_SAMPLES)

    def test_hidden_and_skipped_directories_are_not_searched(self):
        hidden = os.path.join(self.base, ".cache", "deep", "ghost")
        make(hidden, self.files)
        self.assertIsNone(fl.locate("ghost", self.sample)["path"])

    def test_time_budget_is_respected(self):
        import time
        start = time.monotonic()
        fl.locate("nothing-called-this", self.sample, budget=0.5)
        self.assertLess(time.monotonic() - start, 3)


if __name__ == "__main__":
    unittest.main()
