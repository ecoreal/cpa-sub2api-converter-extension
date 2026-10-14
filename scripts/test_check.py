#!/usr/bin/env python3
"""Regression test for the extension checker's reference-graph validation.

`package-extension.sh` and `scripts/check.py` share one rule: every file
reachable from manifest.json and the popup/dashboard HTML must exist, because
the store zip is built from exactly that graph. This test proves the rule
fires on a dangling reference and stays quiet on the real tree.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from check import referenced_files  # noqa: E402


class ReferenceGraphTests(unittest.TestCase):
    def test_real_tree_has_no_dangling_references(self) -> None:
        dangling = [path for path in referenced_files() if not (ROOT / path).is_file()]
        self.assertEqual([], dangling)

    def test_graph_includes_html_js_and_css(self) -> None:
        files = referenced_files()
        for expected in (
            "manifest.json",
            "popup.html",
            "popup.css",
            "popup.js",
            "dashboard.html",
            "dashboard.css",
            "dashboard.js",
            "converter-core.js",
            "remote-request.js",
        ):
            self.assertIn(expected, files)

    def test_dangling_reference_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "extension"
            shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns(
                "dist", "__pycache__", ".git", ".claude",
            ))
            dashboard = copy / "dashboard.html"
            dashboard.write_text(
                dashboard.read_text(encoding="utf-8").replace(
                    'src="./remote-request.js"', 'src="./missing-file.js"'
                ),
                encoding="utf-8",
            )

            import check as check_module

            original_root = check_module.ROOT
            try:
                check_module.ROOT = copy
                dangling = [
                    path for path in check_module.referenced_files()
                    if not (copy / path).is_file()
                ]
            finally:
                check_module.ROOT = original_root

            self.assertEqual(["missing-file.js"], dangling)


if __name__ == "__main__":
    unittest.main()
