#!/usr/bin/env python3

import functools
import json
import os
import re
import subprocess
from pathlib import Path

import _hook
import gh_support  # noqa: E402
import ticket_shape  # noqa: E402

GH_TIMEOUT_SECONDS = 5
GIT_REMOTE_TIMEOUT_SECONDS = 2

REPO_GATE_PATH = ".claude/hooks/close-gate.py"

TICKETIFY_PATH = Path.home() / "bin" / "file-issue"

def write_criteria_hint() -> str:
    if TICKETIFY_PATH.is_file():
        return "run `~/bin/file-issue ticketify <n>` to write them"
    return (
        "add an `## Acceptance criteria` heading to the issue body, one `- [ ]` per "
        "checkable claim"
    )

ISSUE_CLOSE_RE = re.compile(r"\bgh\s+issue\s+close\b")
API_STATE_CLOSED_RE = re.compile(
    r"\bgh\s+api\b[^\n]*(?:-f|--field)\s+['\"]?state\s*=\s*['\"]?closed\b",
    re.IGNORECASE,
)
API_GRAPHQL_RE = re.compile(r"\bgh\s+api\s+graphql\b")
CLOSE_ISSUE_MUTATION_RE = re.compile(r"\bcloseIssue\b")

ISSUE_NUMBER_FROM_CLOSE_RE = re.compile(
    r"\bgh\s+issue\s+close\s+(?:(?:-R|--repo)(?:\s+|=)\S+\s+)*(\d+)\b"
)
ISSUE_NUMBER_FROM_PATH_RE = re.compile(r"\bissues/(\d+)\b")

NON_DELIVERY_REASON_RE = re.compile(
    r"--reason(?:\s+|=)(['\"]?)(not[ _-]planned|duplicate)\1(?!\S)",
    re.IGNORECASE,
)
API_NON_DELIVERY_REASON_RE = re.compile(
    r"(?:-f|--field|-F|--raw-field)(?:\s+|=)['\"]?state_reason\s*=\s*"
    r"['\"]?(?:not[ _-]planned|duplicate)\b",
    re.IGNORECASE,
)

REPO_FLAG_RE = re.compile(r"(?:-R|--repo)(?:\s+|=)(['\"]?)([^\s'\";|&]+)\1")
CD_RE = re.compile(r"\bcd\s+(?:'([^']*)'|\"([^\"]*)\"|([^\s;|&]+))")

COMMENT_HEREDOC_RE = re.compile(
    r"--comment\s+\"\$\(cat\s*<<-?\s*'?(?P<tag>\w+)'?\s*\n(?P<body>.*?)\n\s*(?P=tag)\s*\)\"",
    re.DOTALL,
)
COMMENT_DQUOTE_RE = re.compile(r'--comment\s+"((?:[^"\\]|\\.)*)"', re.DOTALL)
COMMENT_SQUOTE_RE = re.compile(r"--comment\s+'((?:[^'\\])*)'", re.DOTALL)

RECORD_HEADING = "## Closing record"
REVSPEC = r"[A-Za-z0-9._/@{}~^+-]+"
RANGE_LINE_RE = re.compile(rf"^[ \t]*`?({REVSPEC})\.\.({REVSPEC})`?[ \t]*$", re.MULTILINE)
BULLET_RE = re.compile(r"^[ \t]*-\s+(.*)$", re.MULTILINE)

REPO_REF = r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*"
SUPERSEDED_RE = re.compile(
    rf"^[ \t]*`?Superseded by (?:({REPO_REF}))?#(\d+)`?[ \t]*\.?[ \t]*$", re.MULTILINE)

def detect_close_route(command: str) -> str | None:
    if ISSUE_CLOSE_RE.search(command):
        return "issue-close"
    if API_STATE_CLOSED_RE.search(command):
        return "api-state-closed"
    if API_GRAPHQL_RE.search(command) and CLOSE_ISSUE_MUTATION_RE.search(command):
        return "api-graphql"
    return None

def declares_non_delivery(command: str) -> bool:
    spans = _hook.quoted_spans(command)
    for pattern in (NON_DELIVERY_REASON_RE, API_NON_DELIVERY_REASON_RE):
        if _hook.unquoted_matches(pattern, command, spans):
            return True
    return False

def close_is_only_quoted_prose(command: str) -> bool:
    spans = _hook.quoted_spans(command)
    for pattern in (ISSUE_CLOSE_RE, API_STATE_CLOSED_RE, API_GRAPHQL_RE):
        if _hook.unquoted_matches(pattern, command, spans):
            return False
    return True

def extract_repo_flag(command: str) -> str | None:
    matches = _hook.unquoted_matches(REPO_FLAG_RE, command)
    return matches[-1].group(2) if matches else None

def effective_cwd(command: str, cwd: str | None) -> str | None:
    route = None
    for pattern in (ISSUE_CLOSE_RE, API_STATE_CLOSED_RE, API_GRAPHQL_RE):
        m = pattern.search(command)
        if m and (route is None or m.start() < route):
            route = m.start()
    if route is None:
        return cwd
    target = None
    for m in _hook.unquoted_matches(CD_RE, command):
        if m.start() >= route:
            break
        target = m.group(1) or m.group(2) or m.group(3)
    if not target or target == "-":
        return cwd
    path = os.path.expanduser(target)
    if not os.path.isabs(path):
        if not cwd:
            return cwd
        path = os.path.join(cwd, path)
    return path if os.path.isdir(path) else cwd

def extract_issue_number(command: str) -> int | None:
    m = ISSUE_NUMBER_FROM_CLOSE_RE.search(command)
    if m:
        return int(m.group(1))
    m = ISSUE_NUMBER_FROM_PATH_RE.search(command)
    if m:
        return int(m.group(1))
    return None

def extract_inline_comment(command: str) -> str | None:
    m = COMMENT_HEREDOC_RE.search(command)
    if m:
        return m.group("body")
    m = COMMENT_DQUOTE_RE.search(command)
    if m:
        return m.group(1)
    m = COMMENT_SQUOTE_RE.search(command)
    if m:
        return m.group(1)
    return None

def find_marker_text(text: str | None) -> str | None:
    if text is None:
        return None
    stripped = text.strip()
    if not stripped.startswith(RECORD_HEADING):
        return None
    return stripped[len(RECORD_HEADING):].lstrip("\n")

def most_recent_record(comments: list) -> str | None:
    for c in reversed(comments or []):
        body = c.get("body", "") if isinstance(c, dict) else ""
        marker = find_marker_text(body)
        if marker is not None:
            return marker
    return None

def count_body_criteria(body: str) -> int | None:
    if not ticket_shape.CRITERIA_HEADING_RE.search(body):
        return None
    section = ticket_shape.section_text(body, ticket_shape.CRITERIA_HEADING_RE)
    return len(ticket_shape.CRITERIA_ITEM_RE.findall(section))

def _bullet_count_denial(record_text: str, criteria_count: int,
                          close_ticket_stub_text: str = "close-ticket"):
    if criteria_count == 0:
        return (
            "deny",
            "missing-acceptance-criteria",
            "the issue body's `## Acceptance criteria` heading has no `- [ ]` items. Plain "
            "`- ` bullets don't count — only `- [ ]` checkbox items do. Neither `No diff.` "
            "nor `Superseded by #<n>` stands in for criteria that were never written: "
            f"{write_criteria_hint()}, then run "
            f"`{close_ticket_stub_text}` to close it.",
        ), []
    bullets = [b.strip() for b in BULLET_RE.findall(record_text) if b.strip()]
    if len(bullets) != criteria_count:
        return (
            "deny",
            "criteria-count-mismatch",
            f"{criteria_count} acceptance criteria in the body but {len(bullets)} "
            "bullets in the closing record — one bullet per criterion, in the body's "
            f"own order. Run `{close_ticket_stub_text}` instead of writing the record by "
            "hand — it generates exactly one bullet per criterion.",
        ), []
    return None, bullets

def evaluate_record(record_text: str, criteria_count: int | None,
                    close_ticket_stub_text: str = "close-ticket") -> tuple[str, str, str]:
    declares_no_diff = record_text.lstrip().startswith("No diff.")
    superseded = SUPERSEDED_RE.search(record_text)

    if superseded is not None:
        number = int(superseded.group(2))
        if criteria_count is None:
            return ("allow", "superseded",
                    f"superseded by #{number}, and the body declares no criteria.")
        denial, bullets = _bullet_count_denial(record_text, criteria_count, close_ticket_stub_text)
        if denial is not None:
            return denial
        return ("allow", "superseded",
                f"superseded by #{number}, with one bullet per criterion.")

    if declares_no_diff:
        if criteria_count is None:
            return "allow", "no-diff", "No diff. declared, and the body declares no criteria."
        if criteria_count == 0:
            return (
                "deny",
                "missing-acceptance-criteria",
                "the issue body's `## Acceptance criteria` heading has no `- [ ]` items. "
                "Plain `- ` bullets don't count — only `- [ ]` checkbox items do. Neither "
                "`No diff.` nor `Superseded by #<n>` stands in for criteria that were never "
                f"written: {write_criteria_hint()}.",
            )
        return (
            "deny",
            "no-diff-with-criteria",
            "the closing record declares `No diff.` but the issue body carries a `## "
            "Acceptance criteria` heading — `No diff.` stands only for a ticket that never "
            "carried criteria. Run `close-ticket` to verify and record them.",
        )

    if not RANGE_LINE_RE.search(record_text):
        return (
            "deny",
            "no-range-or-no-diff",
            "the closing record declares neither `No diff.`, a `base..head` range "
            "standing alone on its own line, nor `Superseded by #<n>` — a range written "
            f"as a bullet doesn't count. Run `{close_ticket_stub_text}` instead of "
            "writing the record by hand.",
        )

    if criteria_count is None:
        return (
            "deny",
            "missing-acceptance-criteria",
            "the issue body has no `## Acceptance criteria` heading. If this ticket truly "
            "carries no commit, post a `## Closing record` comment declaring `No diff.`; "
            f"otherwise {write_criteria_hint()}, then run "
            f"`{close_ticket_stub_text}` to close it.",
        )

    denial, bullets = _bullet_count_denial(record_text, criteria_count, close_ticket_stub_text)
    if denial is not None:
        return denial

    return "allow", "met", "one bullet per criterion, in the body's own order."

def derive_repo(cwd: str | None) -> str:
    if not cwd:
        return ""
    try:
        result = subprocess.run(
            ["git", "-C", cwd, "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=GIT_REMOTE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if result.returncode != 0:
        return ""
    m = re.search(r"[:/]([^/:]+/[^/]+?)(?:\.git)?\s*$", result.stdout.strip())
    return m.group(1) if m else ""

@functools.lru_cache(maxsize=None)
def repo_toplevel(cwd: str | None) -> Path | None:
    if not cwd:
        return None
    try:
        result = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=GIT_REMOTE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return Path(result.stdout.strip())

def ships_repo_gate(cwd: str | None) -> bool:
    top = repo_toplevel(cwd)
    if top is None:
        return False
    gate = top / REPO_GATE_PATH
    return gate.is_file() and gate.resolve() != Path(__file__).resolve()

def close_ticket_stub(issue_number, cwd: str | None, repo_flag: str | None) -> str:
    checkout = repo_toplevel(cwd)
    if checkout is not None and not repo_flag:
        checkout_value = str(checkout)
    else:
        checkout_value = "<a checkout of this repo at the range's head>"
    vendored = checkout is not None and (checkout / "bin" / "close-ticket").is_file()
    tool = "bin/close-ticket" if vendored else "~/.agents/skills/bin/close-ticket"
    repo_arg = f" --repo {repo_flag}" if repo_flag else ""
    return f"{tool} {issue_number} <base>..<head> {checkout_value}{repo_arg}"

def fetch_issue(gh_path: str, cwd: str | None, issue_number: int,
                repo: str | None = None) -> tuple[str, list, str | None]:
    gh = gh_support.bind_gh(gh_path, repo, timeout=GH_TIMEOUT_SECONDS)
    try:
        result = gh("issue", "view", str(issue_number), "--json", "body,comments",
                    cwd=cwd, capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        return "", [], "gh-timeout"
    except OSError:
        return "", [], "gh-not-found"
    if result.returncode != 0:
        return "", [], "gh-error"
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return "", [], "gh-bad-response"
    return data.get("body", "") or "", data.get("comments", []) or [], None

def _row(payload: dict, repo: str, issue_number, verdict: str, reason: str,
         gh_path: str) -> None:
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(
        payload, verdict,
        repo=repo or "",
        issue=issue_number,
        reason=reason,
        gh=gh_path or "",
    ))

def deny(payload: dict, repo: str, issue_number, reason: str, gh_path: str,
         human_message: str, verdict: str = "deny") -> None:
    _row(payload, repo, issue_number, verdict, reason, gh_path)
    _hook.deny(human_message)

def allow(payload: dict, repo: str, issue_number, reason: str, gh_path: str) -> None:
    _row(payload, repo, issue_number, "allow", reason, gh_path)

def main() -> None:
    resolved_gh = gh_support.gh_bin()

    payload, ok = _hook.read_payload()
    if not ok:
        _row(payload, "", None, "allow", "unparseable-stdin", resolved_gh or "")
        return

    cwd = payload.get("cwd")
    tool_input = payload["tool_input"]

    command = tool_input.get("command")
    if not isinstance(command, str) or not command.strip():
        _row(payload, "", None, "allow", "unparseable-stdin", resolved_gh or "")
        return

    route = detect_close_route(command)
    if route is None:
        return

    issue_number = extract_issue_number(command)
    if issue_number is None and close_is_only_quoted_prose(command):
        _row(payload, "", None, "allow", "close-mentioned-not-invoked", resolved_gh or "")
        return

    repo_flag = extract_repo_flag(command)
    gh_cwd = effective_cwd(command, cwd)
    cwd_repo = derive_repo(gh_cwd)
    repo = repo_flag or cwd_repo

    if repo_flag in (None, "", cwd_repo) and ships_repo_gate(gh_cwd):
        _row(payload, repo, issue_number, "allow", "repo-gate-owns-repo",
             resolved_gh or "")
        return

    if declares_non_delivery(command):
        _row(payload, repo, issue_number, "allow", "non-delivery-close",
             resolved_gh or "")
        return

    if issue_number is None:
        deny(payload, repo, None, "unparseable-issue-number", resolved_gh or "",
             "could not parse an issue number from this close command.")
        return

    stub_text = close_ticket_stub(issue_number, gh_cwd, repo_flag)

    inline_record = find_marker_text(extract_inline_comment(command))

    if resolved_gh is None:
        deny(payload, repo, issue_number, "gh-not-found", "",
             "gh is not resolvable on this machine — cannot verify, so the close is refused.",
             verdict="degraded")
        return

    body, comments, fetch_err = fetch_issue(resolved_gh, gh_cwd, issue_number, repo_flag)
    if fetch_err:
        deny(payload, repo, issue_number, fetch_err, resolved_gh,
             f"could not verify against GitHub ({fetch_err}) — failing closed.",
             verdict="degraded")
        return

    record_text = inline_record if inline_record is not None else most_recent_record(comments)
    if record_text is None:
        deny(payload, repo, issue_number, "no-closing-record", resolved_gh,
             "no `## Closing record` found — neither on the close command's own "
             "--comment nor as an issue comment. Run close-ticket instead — it verifies "
             f"the criteria, posts the record, and closes in one step:\n\n    {stub_text}"
             "\n\nOr if this ticket truly carries no commit, post a `## Closing record` "
             "comment declaring `No diff.`")
        return

    criteria_count = count_body_criteria(body)
    verdict, reason, message = evaluate_record(record_text, criteria_count, stub_text)
    if verdict == "allow":
        allow(payload, repo, issue_number, reason, resolved_gh)
    else:
        deny(payload, repo, issue_number, reason, resolved_gh, message)

if __name__ == "__main__":
    main()
