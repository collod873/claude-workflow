#!/usr/bin/env python3
import re

import _hook

READ_CMDS = r"(?:cat|head|tail|less|more|bat)"

SEARCH_READ_CMDS = r"(?:cat|head|tail|less|more|bat|grep|rg|ag|tree)"
SEARCH_READ_WORD = re.compile(rf"\b{SEARCH_READ_CMDS}\b")

WASTEFUL_DIR_NAMES = (
    r"node_modules|__pycache__|\.next|dist|build|\.cache|\.tox|"
    r"\.mypy_cache|venv|\.venv"
)

WASTEFUL_DIRS = re.compile(
    rf"(?:^|[\s/])(?:{WASTEFUL_DIR_NAMES})/"
)

DOTENV_READ = re.compile(
    rf"\b{READ_CMDS}\s+[^;&|\n]*\.env(?!\.(?:example|sample|template|dist))\b"
)

GIT_INTERNALS = re.compile(
    rf"\b{READ_CMDS}\s+[^;&|\n]*\.git/"
)

SAFE_PATTERNS = re.compile(
    r"\b(?:rm\s+-rf|rm\s+-r|rmdir|mkdir|install|uninstall)\b"
)

EXCLUDE_FLAG = re.compile(r"--exclude(?:-dir)?[=\s]")

GH_ISSUE_CREATE = re.compile(r"\bgh\s+issue\s+create\b")
GH_ISSUE_CLOSE = re.compile(r"\bgh\s+issue\s+close\b")
COMPOUND_OPERATOR = re.compile(r"&&|\|\||;|\|")


def check(command: str) -> tuple[str, str]:
    spans = _hook.quoted_spans(command)

    if _hook.unquoted_matches(DOTENV_READ, command, spans):
        return "dotenv", (
            "Reading .env files via shell leaks secrets into context. "
            "Use environment variables, or the Read tool if you must inspect the file."
        )

    if _hook.unquoted_matches(GIT_INTERNALS, command, spans):
        return "git-internals", "Reading .git/ internals; use git commands instead."

    if _hook.unquoted_matches(GH_ISSUE_CREATE, command, spans):
        return "gh-issue-create", (
            "gh issue create is blocked; file issues through ~/bin/file-issue instead, "
            "which always writes the ticket shape drain expects. Filing a ticket you just "
            "wrote a failing acceptance test for? file-issue ticket --test <path> hands "
            "the test over instead of leaving it for lane 04 to author cold -- list the "
            "stub subject file too."
        )

    if _hook.unquoted_matches(GH_ISSUE_CLOSE, command, spans) and _hook.unquoted_matches(
        COMPOUND_OPERATOR, command, spans
    ):
        return "compound-close", (
            "gh issue close appeared alongside another command (&&, ;, ||, or |), so "
            "nothing in this command ran. Re-run the close alone, so the close gate "
            "only ever sees a lone close."
        )

    if _hook.unquoted_matches(SAFE_PATTERNS, command, spans):
        return "", ""

    if _hook.unquoted_matches(EXCLUDE_FLAG, command, spans):
        return "", ""

    if _hook.unquoted_matches(WASTEFUL_DIRS, command, spans):
        if _hook.unquoted_matches(SEARCH_READ_WORD, command, spans):
            return "wasteful-dir", (
                "Reading from a large generated directory wastes context. "
                "Use a more targeted path, or pass --exclude-dir to skip it."
            )

    return "", ""


def main():
    data, ok = _hook.read_payload()
    command = data["tool_input"].get("command", "") if ok else ""
    guard, reason = check(command) if command else ("", "")

    extra = {"guard": guard} if guard else {}
    _hook.append_log(_hook.HOOK_NAME,
                     _hook.run_row(data, "deny" if guard else "allow", **extra))

    if guard:
        _hook.deny(reason)


if __name__ == "__main__":
    main()
