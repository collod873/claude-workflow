#!/usr/bin/env python3
import re
from pathlib import Path

import _hook
import adr_shape

LANDED_RE = re.compile(r"^\d{4}-.+\.md$")
INDEX_NAME = "INDEX.md"

HAND_NUMBERED = (
    'File it with `~/bin/new-adr "<the ruling as a sentence>"`, then '
    "`new-adr --land docs/adr/draft-<slug>.md`; the number is claimed at the land and "
    "never typed, because two authors write docs/adr/ from separate trees and a number "
    "picked by scanning the directory is picked against a corpus the other is already "
    "past. Landing refuses an empty `reversal:` or a body over 150 words: an ADR records "
    "a constraint that binds later work, not a note about what was done."
)

GENERATED_INDEX = (
    "docs/adr/INDEX.md is generated from the corpus, so a hand-edit is overwritten on "
    "the next run. Change the ADR itself, then `~/bin/adr-check --fix` to re-render."
)


def _repo_root(start: Path) -> Path | None:
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def check(file_path: str) -> tuple[str, str]:
    if not file_path:
        return "", ""
    try:
        path = Path(file_path)
        if path.parent.name != "adr" or path.parent.parent.name != "docs":
            return "", ""
        if not path.parent.is_dir():
            return "", ""
        root = _repo_root(path.parent)
        if root is None:
            return "", ""
        rel_parts = path.parent.relative_to(root).parts
        if any(part in adr_shape.SKIP_DIRS for part in rel_parts):
            return "", ""
    except (OSError, ValueError):
        return "", ""

    if path.name == INDEX_NAME:
        return "generated-index", GENERATED_INDEX

    if LANDED_RE.match(path.name) and not path.exists():
        return "hand-numbered", HAND_NUMBERED

    return "", ""


def main():
    data, ok = _hook.read_payload()
    if not _hook.enrolled(data.get("cwd")):
        return
    file_path = data["tool_input"].get("file_path", "") if ok else ""
    guard, reason = check(file_path)

    if guard:
        _hook.append_log(_hook.HOOK_NAME, _hook.run_row(data, "deny", guard=guard))
        _hook.deny(reason)


if __name__ == "__main__":
    main()
