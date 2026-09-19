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
GH_API = re.compile(r"\bgh\s+api\b")
API_STATE_CLOSED = re.compile(
    r"(?:-f|--field)\s+['\"]?state\s*=\s*['\"]?closed\b", re.IGNORECASE
)
API_CLOSE_ISSUE_MUTATION = re.compile(r"\bgraphql\b[^\n]*\bcloseIssue\b")

PUSH_TO_MAIN = re.compile(
    r"\bgit\s+push\b[^;&|\n]*(?<![\w./-])(?:refs/heads/)?main(?![\w./-])"
)

GIT_COMMIT = re.compile(r"\bgit\s+commit\b")

GH_PR_WRITE = re.compile(r"\bgh\s+pr\s+(?:create|edit)\b")


def flag_value_patterns(flag: str) -> tuple[re.Pattern, ...]:
    return (
        re.compile(
            rf"(?<![\w-]){flag}(?:\s+|=)\"\$\(cat\s*<<-?\s*'?(?P<tag>\w+)'?\s*\n"
            r"(?P<body>.*?)\n\s*(?P=tag)\s*\)\"",
            re.DOTALL,
        ),
        re.compile(rf'(?<![\w-]){flag}(?:\s+|=)"(?P<body>(?:[^"\\]|\\.)*)"', re.DOTALL),
        re.compile(rf"(?<![\w-]){flag}(?:\s+|=)'(?P<body>(?:[^'\\])*)'", re.DOTALL),
    )


COMMIT_MESSAGE = flag_value_patterns(r"(?:--message|-a?m|-ma)")
PR_BODY = flag_value_patterns(r"(?:--body|-b)")

CLOSING_KEYWORD = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+"
    r"(?:[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*)?#(?P<num>\d+)",
    re.IGNORECASE,
)


def flag_values(command: str, anchor: re.Pattern, patterns: tuple[re.Pattern, ...]) -> list[str]:
    first = anchor.search(command)
    if not first:
        return []
    tail = command[first.start():]
    heredoc, *quoted = patterns
    values = [m.group("body") for m in heredoc.finditer(tail)]
    remainder = heredoc.sub("", tail)
    for pattern in quoted:
        values.extend(m.group("body") for m in pattern.finditer(remainder))
    return values


CLOSING_WRITES = (
    (GIT_COMMIT, COMMIT_MESSAGE, "commit-closes-ticket", "commit message", "pushing it"),
    (GH_PR_WRITE, PR_BODY, "pr-closes-ticket", "pull request body", "merging it"),
)


def closes_an_issue(command: str, spans) -> bool:
    if _hook.unquoted_matches(GH_ISSUE_CLOSE, command, spans):
        return True
    if not _hook.unquoted_matches(GH_API, command, spans):
        return False
    return bool(API_STATE_CLOSED.search(command) or API_CLOSE_ISSUE_MUTATION.search(command))


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
            "gh issue create is blocked; file through `core/bin/file-issue ticket "
            "--title <title> --body-file <path>`, which runs the ticket's checks first "
            "and refuses a misshapen ticket or one whose checks already pass."
        )

    if closes_an_issue(command, spans):
        return "gh-issue-close", (
            "closing a ticket by hand is blocked; a ticket is closed by the closer, "
            "which runs its checks on the merge commit and posts the `## Closing "
            "record`. No closer has shipped yet, so leave the ticket open and say so."
        )

    if _hook.unquoted_matches(PUSH_TO_MAIN, command, spans):
        return "push-to-main", (
            "main takes no direct push. Commit locally, then run `core/bin/land`: it "
            "opens a PR from your commits and merges it, or leaves auto-merge on."
        )

    for anchor, patterns, guard, where, trigger in CLOSING_WRITES:
        if not _hook.unquoted_matches(anchor, command, spans):
            continue
        for text in flag_values(command, anchor, patterns):
            m = CLOSING_KEYWORD.search(text)
            if m:
                issue = m.group("num")
                return guard, (
                    f"this {where} closes #{issue} with a GitHub keyword "
                    f"({m.group(0).strip()!r}); {trigger} lets GitHub close the ticket "
                    "on its own, with no `## Closing record` and none of the ticket's "
                    "checks run. Drop the keyword (a bare "
                    f"'#{issue}' or 'Ticket: #{issue}' still links the issue without "
                    "closing it); the closer closes the ticket once the work lands."
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
        _hook.deny("PreToolUse", reason)


if __name__ == "__main__":
    main()
