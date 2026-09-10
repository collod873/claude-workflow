#!/usr/bin/env python3
import os
import shutil
import subprocess
from pathlib import Path

import _hook

RENDERER = _hook.BIN / "md-html"

RENDER_TIMEOUT_SECONDS = 20

MARKDOWN_SUFFIXES = (".md", ".markdown")

TOC_MARKER = 'class="toc"'

FALLBACK_NODE = Path.home() / ".local/node/bin/node"


def node() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    return str(FALLBACK_NODE) if os.access(FALLBACK_NODE, os.X_OK) else None


def render(source: Path, page: Path) -> tuple[str, str | None]:
    runner = node()
    if runner is None:
        return "no-runner", None

    argv = [runner, str(RENDERER), str(source), "-o", str(page)]
    if TOC_MARKER in _read(page):
        argv.append("--toc")

    try:
        result = subprocess.run(
            argv, capture_output=True, text=True, timeout=RENDER_TIMEOUT_SECONDS
        )
    except subprocess.TimeoutExpired:
        return "error", f"md-html timed out after {RENDER_TIMEOUT_SECONDS}s"
    except OSError:
        return "no-runner", None

    if result.returncode != 0:
        return "error", (result.stderr or result.stdout).strip()[:300]
    return "rendered", None


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def sibling_page(file_path: str) -> tuple[Path | None, Path | None]:
    if not file_path:
        return None, None

    source = Path(file_path)
    if source.suffix.lower() not in MARKDOWN_SUFFIXES:
        return None, None
    if not source.is_file():
        return None, None

    page = source.with_suffix(".html")
    return (source, page) if page.is_file() else (source, None)


def main():
    data, ok = _hook.read_payload()
    if not _hook.enrolled(data.get("cwd")):
        return
    file_path = _hook.edited_path(data["tool_input"]) if ok else ""

    source, page = sibling_page(file_path)
    if source is None:
        verdict, error = "not-markdown", None
    elif page is None:
        verdict, error = "no-sibling", None
    else:
        verdict, error = render(source, page)

    _hook.append_log(
        _hook.HOOK_NAME,
        _hook.run_row(data, verdict, page=page.name if page else "", error=error or ""),
    )


if __name__ == "__main__":
    main()
