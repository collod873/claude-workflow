import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "md-html")

SAMPLE = (
    "# The title\n"
    "\n"
    "A lead paragraph.\n"
    "\n"
    "## First section\n"
    "\n"
    "| a | b |\n"
    "|---|---|\n"
    "| 1 | 2 |\n"
    "\n"
    "```js\n"
    "const x = 1;\n"
    "```\n"
    "\n"
    "## First section\n"
    "\n"
    "Duplicate heading text, so the slugs have to differ.\n"
)


def run(*args, **kwargs):
    return subprocess.run(["node", SCRIPT, *args], capture_output=True, text=True, **kwargs)


class MdHtml(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)
        self.doc = self.tmp_path / "doc.md"
        self.doc.write_text(SAMPLE, encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def test_help_exits_zero(self):
        assert run("--help").returncode == 0

    def test_no_input_is_an_error(self):
        result = run()
        assert result.returncode == 1
        assert "no input file" in result.stderr

    def test_writes_a_standalone_page_beside_the_input(self):
        result = run(str(self.doc))
        assert result.returncode == 0

        out = self.doc.with_suffix(".html")
        assert out.exists()
        assert result.stdout.strip() == str(out)

        html = out.read_text(encoding="utf-8")
        assert html.startswith("<!doctype html>")
        assert "<style>" in html
        assert "<script" not in html
        assert "http://" not in html and "https://" not in html

    def test_title_comes_from_the_first_h1(self):
        run(str(self.doc))
        assert "<title>The title</title>" in self.doc.with_suffix(".html").read_text(encoding="utf-8")

    def test_title_flag_wins(self):
        run(str(self.doc), "--title", "Something else")
        assert "<title>Something else</title>" in self.doc.with_suffix(".html").read_text(encoding="utf-8")

    def test_repeated_headings_get_distinct_ids(self):
        run(str(self.doc))
        html = self.doc.with_suffix(".html").read_text(encoding="utf-8")
        assert '<h2 id="first-section">' in html
        assert '<h2 id="first-section-1">' in html

    def test_tables_are_wrapped_so_they_scroll(self):
        run(str(self.doc))
        html = self.doc.with_suffix(".html").read_text(encoding="utf-8")
        assert '<div class="tbl"><table>' in html
        assert "</table></div>" in html

    def test_toc_lands_after_the_lead_not_above_the_title(self):
        run(str(self.doc), "--toc")
        html = self.doc.with_suffix(".html").read_text(encoding="utf-8")
        assert html.index("<h1") < html.index('class="toc"')
        assert '<a href="#first-section">' in html

    def test_stdout_writes_no_file(self):
        result = run(str(self.doc), "--stdout")
        assert result.returncode == 0
        assert result.stdout.startswith("<!doctype html>")
        assert not self.doc.with_suffix(".html").exists()

    def test_out_and_stdout_conflict(self):
        result = run(str(self.doc), "--stdout", "-o", str(self.tmp_path / "x.html"))
        assert result.returncode == 1

    def test_refuses_to_overwrite_its_own_input(self):
        path = self.tmp_path / "doc.html"
        path.write_text(SAMPLE, encoding="utf-8")
        result = run(str(path), "-o", str(path))
        assert result.returncode == 1
        assert "refusing to overwrite" in result.stderr

    def test_missing_input_names_the_path(self):
        result = run(str(self.tmp_path / "nope.md"))
        assert result.returncode == 1
        assert "nope.md" in result.stderr


if __name__ == "__main__":
    unittest.main()
