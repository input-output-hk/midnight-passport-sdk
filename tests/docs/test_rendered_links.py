"""Owned temporary rendered-site fixtures; no Jekyll, browser or network required."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/docs/check-rendered.py"
SPEC = importlib.util.spec_from_file_location("rendered_docs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RenderedLinkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="passport-rendered-links-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "site"
        self.root.mkdir()

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def check(self, base="/midnight-passport-sdk"):
        return MODULE.check_site(self.root, base)

    def test_rendered_base_relative_assets_entities_queries_and_unicode_anchors(self):
        self.write("index.html", '<a href="/midnight-passport-sdk/guide/?a=1&amp;b=2#%C3%A9">Guide</a><img src="assets/icon.svg">')
        self.write("guide/index.html", '<h2 id="é">Example</h2><a href="../#home">Home</a>')
        self.write("assets/icon.svg", '<svg/>')
        with (self.root / "index.html").open("a") as target:
            target.write('<h2 id="home">Home</h2><script src="assets/code.js"></script><link href="assets/site.css">')
        self.write("assets/code.js", "// fixture")
        self.write("assets/site.css", "body {}")
        result = self.check()
        self.assertEqual(result["outcome"], "passed")
        self.assertEqual(result["pages"], 2)
        self.assertEqual(result["localLinksAssetsAndAnchors"], 5)
        self.assertEqual(result["errors"], [])

    def test_missing_assets_and_anchors_fail_without_fetching_external_urls(self):
        self.write("index.html", '<a href="https://example.invalid/no-network">External</a><a href="//example.invalid/also-skipped">Other</a><a href="#absent">Bad</a><img src="missing.svg">')
        result = self.check()
        self.assertEqual(result["outcome"], "failed")
        self.assertEqual(result["externalLinksNotFetched"], 2)
        self.assertEqual([item["error"] for item in result["errors"]], ["missing local anchor", "missing local target"])

    def test_absolute_links_must_use_the_configured_base(self):
        self.write("index.html", '<a href="/guide/">Wrong base</a>')
        self.write("guide/index.html", "Guide")
        self.assertEqual(self.check()["outcome"], "failed")
        self.assertEqual(self.check("")["outcome"], "passed")

    def test_path_and_symlink_escapes_are_refused_even_when_the_file_exists(self):
        outside = Path(self.temporary.name) / "outside.html"
        outside.write_text("<h1 id='private'>Outside</h1>")
        self.write("index.html", '<a href="../outside.html">Parent</a><a href="alias.html">Alias</a>')
        (self.root / "alias.html").symlink_to(outside)
        result = self.check()
        self.assertEqual(result["outcome"], "failed")
        self.assertTrue(all("escapes" in error["error"] for error in result["errors"]))
        self.assertEqual(result["pages"], 1)

    def test_duplicate_ids_are_reported(self):
        self.write("index.html", '<h1 id="same">A</h1><h2 id="same">B</h2>')
        self.assertEqual(self.check()["errors"], [{"source": "index.html", "fragment": "same", "error": "duplicate id"}])

    def test_empty_output_and_invalid_base_refuse(self):
        with self.assertRaisesRegex(ValueError, "no HTML"):
            self.check()
        for base in ("relative", "/base/", "/../base", "//base", "/base?query", "/base%2fother"):
            with self.subTest(base=base), self.assertRaises(ValueError):
                self.check(base)

    def test_large_html_is_not_admitted(self):
        self.write("index.html", "x" * (MODULE.MAX_HTML_BYTES + 1))
        result = self.check()
        self.assertEqual(result["outcome"], "failed")
        self.assertEqual(result["pages"], 0)
        self.assertIn("byte bound", result["errors"][0]["error"])

    def test_base_href_refuses_relative_and_fragment_false_passes(self):
        fixtures = (
            '<base href="/midnight-passport-sdk/elsewhere/"><a href="valid.html">Misresolved</a>',
            '<base href="/midnight-passport-sdk/elsewhere/"><h2 id="here">Here</h2><a href="#here">Misresolved anchor</a>',
        )
        self.write("valid.html", "Existing only beside the current page")
        for content in fixtures:
            with self.subTest(content=content):
                self.write("index.html", content)
                result = self.check()
                self.assertEqual(result["outcome"], "failed")
                self.assertIn({"source": "index.html", "error": "base href directives are not supported"}, result["errors"])

    def test_cli_receipts_are_exclusive_and_failures_have_nonzero_status(self):
        self.write("index.html", '<a href="#absent">Fail</a>')
        receipt = Path(self.temporary.name) / "receipt.json"
        command = [sys.executable, str(SCRIPT), str(self.root), "--output", str(receipt)]
        first = subprocess.run(command, capture_output=True, text=True, timeout=5)
        self.assertEqual(first.returncode, 1)
        saved = receipt.read_bytes()
        self.assertEqual(json.loads(saved)["outcome"], "failed")
        repeated = subprocess.run(command, capture_output=True, text=True, timeout=5)
        self.assertEqual(repeated.returncode, 2)
        self.assertEqual(receipt.read_bytes(), saved)


if __name__ == "__main__":
    unittest.main()
