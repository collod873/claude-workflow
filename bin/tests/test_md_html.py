import os
import subprocess

import pytest

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


@pytest.fixture
def doc(tmp_path):
    path = tmp_path / "doc.md"
    path.write_text(SAMPLE, encoding="utf-8")
    return path


def test_help_exits_zero():
    assert run("--help").returncode == 0


def test_no_input_is_an_error():
    result = run()
    assert result.returncode == 1
    assert "no input file" in result.stderr


def test_writes_a_standalone_page_beside_the_input(doc):
    result = run(str(doc))
    assert result.returncode == 0

    out = doc.with_suffix(".html")
    assert out.exists()
    assert result.stdout.strip() == str(out)

    html = out.read_text(encoding="utf-8")
    assert html.startswith("<!doctype html>")
    assert "<style>" in html
    assert "<script" not in html
    assert "http://" not in html and "https://" not in html


def test_title_comes_from_the_first_h1(doc):
    run(str(doc))
    assert "<title>The title</title>" in doc.with_suffix(".html").read_text(encoding="utf-8")


def test_title_flag_wins(doc):
    run(str(doc), "--title", "Something else")
    assert "<title>Something else</title>" in doc.with_suffix(".html").read_text(encoding="utf-8")


def test_repeated_headings_get_distinct_ids(doc):
    run(str(doc))
    html = doc.with_suffix(".html").read_text(encoding="utf-8")
    assert '<h2 id="first-section">' in html
    assert '<h2 id="first-section-1">' in html


def test_tables_are_wrapped_so_they_scroll(doc):
    run(str(doc))
    html = doc.with_suffix(".html").read_text(encoding="utf-8")
    assert '<div class="tbl"><table>' in html
    assert "</table></div>" in html


def test_toc_lands_after_the_lead_not_above_the_title(doc):
    run(str(doc), "--toc")
    html = doc.with_suffix(".html").read_text(encoding="utf-8")
    assert html.index("<h1") < html.index('class="toc"')
    assert '<a href="#first-section">' in html


def test_stdout_writes_no_file(doc):
    result = run(str(doc), "--stdout")
    assert result.returncode == 0
    assert result.stdout.startswith("<!doctype html>")
    assert not doc.with_suffix(".html").exists()


def test_out_and_stdout_conflict(doc, tmp_path):
    result = run(str(doc), "--stdout", "-o", str(tmp_path / "x.html"))
    assert result.returncode == 1


def test_refuses_to_overwrite_its_own_input(tmp_path):
    path = tmp_path / "doc.html"
    path.write_text(SAMPLE, encoding="utf-8")
    result = run(str(path), "-o", str(path))
    assert result.returncode == 1
    assert "refusing to overwrite" in result.stderr


def test_missing_input_names_the_path(tmp_path):
    result = run(str(tmp_path / "nope.md"))
    assert result.returncode == 1
    assert "nope.md" in result.stderr
