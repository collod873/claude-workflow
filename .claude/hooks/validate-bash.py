#!/usr/bin/env python3
import re

import _hook

LOCAL_CLOSE_TICKET = _hook.BIN / "close-ticket"

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

GIT_COMMIT = re.compile(r"\bgit\s+commit\b")

COMMIT_MESSAGE_FLAG = r"(?:--message|-a?m|-ma)"
COMMIT_MESSAGE_HEREDOC = re.compile(
    rf"{COMMIT_MESSAGE_FLAG}(?:\s+|=)\"\$\(cat\s*<<-?\s*'?(?P<tag>\w+)'?\s*\n"
    r"(?P<body>.*?)\n\s*(?P=tag)\s*\)\"",
    re.DOTALL,
)
COMMIT_MESSAGE_DQUOTE = re.compile(
    rf'{COMMIT_MESSAGE_FLAG}(?:\s+|=)"((?:[^"\\]|\\.)*)"', re.DOTALL
)
COMMIT_MESSAGE_SQUOTE = re.compile(
    rf"{COMMIT_MESSAGE_FLAG}(?:\s+|=)'((?:[^'\\])*)'", re.DOTALL
)

CLOSING_KEYWORD = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+"
    r"(?:[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*)?#(?P<num>\d+)",
    re.IGNORECASE,
)


def close_ticket_command(issue: str) -> str:
    tool = "bin/close-ticket" if LOCAL_CLOSE_TICKET.is_file() else "~/bin/close-ticket"
    return f"{tool} {issue} <base>..<head> <checkout>"


def extract_commit_messages(command: str) -> list[str]:
    commits = list(GIT_COMMIT.finditer(command))
    if not commits:
        return []
    tail = command[commits[0].start():]
    messages = [m.group("body") for m in COMMIT_MESSAGE_HEREDOC.finditer(tail)]
    remainder = COMMIT_MESSAGE_HEREDOC.sub("", tail)
    for pattern in (COMMIT_MESSAGE_DQUOTE, COMMIT_MESSAGE_SQUOTE):
        messages.extend(m.group(1) for m in pattern.finditer(remainder))
    return messages


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

    if _hook.unquoted_matches(GIT_COMMIT, command, spans):
        for message in extract_commit_messages(command):
            m = CLOSING_KEYWORD.search(message)
            if m:
                issue = m.group("num")
                return "commit-closes-ticket", (
                    f"this commit message closes #{issue} with a GitHub keyword "
                    f"({m.group(0).strip()!r}); pushing it lets GitHub close the ticket "
                    "the moment it parses the message, with no `## Closing record` and "
                    "none of close-ticket's checks run -- the exact bypass the close gate "
                    f"exists to prevent. Drop the keyword (a bare '#{issue}' still links "
                    "the issue without closing it), then close the ticket by running "
                    f"`{close_ticket_command(issue)}` once the work lands."
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
