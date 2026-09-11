#!/usr/bin/env python3
import json
from pathlib import Path

import _hook
import gh_support
import ticket_shape

GH_TIMEOUT_SECONDS = 10

NEEDS_HUMAN_LABEL = "needs-human"
BY_HAND_LABEL = "by-hand"
PRD_LABEL = "prd"

SNAPSHOT_FILENAME = "session-snapshot.json"
TRACKED_LABELS = (PRD_LABEL, NEEDS_HUMAN_LABEL, BY_HAND_LABEL)
TRACKED_FIELDS = "number,title,state,labels,assignees"


def first_criterion_sentence(body: str) -> str | None:
    blocks = ticket_shape.criteria_blocks(body)
    if not blocks:
        return None
    text = ticket_shape.CRITERIA_ITEM_RE.sub("", blocks[0], count=1).strip()
    return ticket_shape.CHECK_MARKER_RE.sub("", text).strip()


def child_counts(gh, repo: str, number) -> tuple[int, int]:
    try:
        raw = gh_support.run_gh(gh, "api", f"repos/{repo}/issues/{number}/sub_issues", "--paginate")
    except gh_support.GhError:
        return 0, 0
    try:
        children = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return 0, 0
    if not isinstance(children, list):
        return 0, 0
    opened = sum(1 for c in children if isinstance(c, dict) and c.get("state") == "open")
    closed = sum(1 for c in children if isinstance(c, dict) and c.get("state") == "closed")
    return opened, closed


def open_issues_by_label(gh, cwd: str, label: str, fields: str = "number,title,body") -> list[dict]:
    try:
        raw = gh_support.run_gh(
            gh, "issue", "list", "--label", label, "--state", "open",
            "--json", fields, cwd=cwd,
        )
    except gh_support.GhError:
        return []
    try:
        issues = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return [i for i in issues if isinstance(i, dict)] if isinstance(issues, list) else []


def resolve_repo(gh, cwd: str) -> str | None:
    try:
        raw = gh_support.run_gh(gh, "repo", "view", "--json", "nameWithOwner", cwd=cwd)
    except gh_support.GhError:
        return None
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return None
    name = data.get("nameWithOwner") if isinstance(data, dict) else None
    return name if isinstance(name, str) and name else None


def prd_lines(gh, repo: str, cwd: str) -> list[str]:
    lines = []
    for issue in open_issues_by_label(gh, cwd, "prd"):
        criterion = first_criterion_sentence(issue.get("body", "") or "")
        if criterion is None:
            continue
        opened, closed = child_counts(gh, repo, issue.get("number"))
        lines.append(f"#{issue.get('number')}: {criterion} ({opened} open, {closed} closed)")
    return lines


def issue_comments(gh, repo: str, number, cwd: str) -> list[dict]:
    try:
        raw = gh_support.run_gh(
            gh, "api", f"repos/{repo}/issues/{number}/comments", "--paginate", cwd=cwd,
        )
    except gh_support.GhError:
        return []
    try:
        comments = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return [c for c in comments if isinstance(c, dict)] if isinstance(comments, list) else []


def needs_human_reason(gh, repo: str, issue: dict, cwd: str) -> str:
    for comment in reversed(issue_comments(gh, repo, issue.get("number"), cwd)):
        body = comment.get("body")
        if isinstance(body, str) and body.strip():
            return body.strip().splitlines()[0].strip()
    body_lines = [ln.strip() for ln in (issue.get("body") or "").splitlines() if ln.strip()]
    return body_lines[-1] if body_lines else ""


def needs_human_lines(gh, repo: str, cwd: str) -> list[str]:
    lines = []
    for issue in open_issues_by_label(gh, cwd, NEEDS_HUMAN_LABEL):
        reason = needs_human_reason(gh, repo, issue, cwd)
        title = issue.get("title") or ""
        lines.append(f"#{issue.get('number')}: {title} needs a human: {reason}")
    return lines


def other_live_session_lines(session_id: str, cwd: str) -> list[str]:
    project = Path(cwd).name if cwd else ""
    sessions = _hook.active_sessions(project, exclude_session_id=session_id)
    return [f"Other live session in this repository: {sid}" for sid in sessions]


def blocked_by_open_issue(gh, repo: str, number, cwd: str) -> bool:
    try:
        raw = gh_support.run_gh(
            gh, "api", f"repos/{repo}/issues/{number}/dependencies/blocked_by",
            "--paginate", cwd=cwd,
        )
    except gh_support.GhError:
        return False
    try:
        blockers = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return False
    if not isinstance(blockers, list):
        return False
    return any(isinstance(b, dict) and b.get("state") == "open" for b in blockers)


def next_by_hand_line(gh, repo: str, cwd: str) -> str | None:
    unassigned = [
        issue for issue in open_issues_by_label(gh, cwd, BY_HAND_LABEL, fields="number,title,body,assignees")
        if not (issue.get("assignees") or [])
    ]
    for issue in sorted(unassigned, key=lambda issue: issue.get("number") or 0):
        if blocked_by_open_issue(gh, repo, issue.get("number"), cwd):
            continue
        title = issue.get("title") or ""
        return f"Next by-hand ticket: #{issue.get('number')}: {title}"
    return None


def load_snapshot() -> dict | None:
    path = _hook.LOG_DIR / SNAPSHOT_FILENAME
    try:
        raw = path.read_text()
    except OSError:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def tracked_tickets(gh, cwd: str) -> dict[int, dict]:
    tickets: dict[int, dict] = {}
    for label in TRACKED_LABELS:
        for issue in open_issues_by_label(gh, cwd, label, fields=TRACKED_FIELDS):
            number = issue.get("number")
            if isinstance(number, int):
                tickets[number] = issue
    return tickets


def ticket_identity(issue: dict) -> tuple:
    labels = tuple(sorted(
        (label.get("name") if isinstance(label, dict) else label)
        for label in (issue.get("labels") or [])
    ))
    assignees = tuple(sorted(
        (who.get("login") if isinstance(who, dict) else who)
        for who in (issue.get("assignees") or [])
    ))
    return (issue.get("title"), issue.get("state"), labels, assignees)


def delta_lines(snapshot: dict, current: dict[int, dict]) -> list[str]:
    previous = {
        ticket.get("number"): ticket
        for ticket in (snapshot.get("tickets") or [])
        if isinstance(ticket, dict) and isinstance(ticket.get("number"), int)
    }
    lines = []
    for number in sorted(set(previous) | set(current)):
        before = previous.get(number)
        after = current.get(number)
        if before is None:
            lines.append(f"#{number}: {after.get('title', '')} — new")
        elif after is None:
            lines.append(f"#{number}: {before.get('title', '')} — gone")
        elif ticket_identity(before) != ticket_identity(after):
            lines.append(f"#{number}: {after.get('title', '')} — changed")
    return lines


def claimed_line(snapshot: dict) -> str | None:
    claimed = snapshot.get("claimed")
    if not isinstance(claimed, dict):
        return None
    number = claimed.get("number")
    if number is None:
        return None
    title = claimed.get("title") or ""
    return f"Your claimed by-hand ticket: #{number}: {title}"


def main() -> None:
    payload, _ok = _hook.read_payload()
    cwd = payload.get("cwd") or "."

    gh_path = gh_support.gh_bin()
    if gh_path is None:
        _hook.append_log(_hook.HOOK_NAME, _hook.run_row(payload, "gh-not-found"))
        return

    gh = gh_support.bind_gh(gh_path, timeout=GH_TIMEOUT_SECONDS)
    repo = resolve_repo(gh, cwd)
    if repo is None:
        _hook.append_log(_hook.HOOK_NAME, _hook.run_row(payload, "no-repo"))
        return

    repo_gh = gh_support.bind_gh(gh_path, repo, timeout=GH_TIMEOUT_SECONDS)
    prds = prd_lines(repo_gh, repo, cwd)
    needs_human = needs_human_lines(repo_gh, repo, cwd)
    other_sessions = other_live_session_lines(payload.get("session_id") or "", cwd)
    by_hand = next_by_hand_line(repo_gh, repo, cwd)

    snapshot = load_snapshot()
    delta = delta_lines(snapshot, tracked_tickets(repo_gh, cwd)) if snapshot is not None else []
    claimed = claimed_line(snapshot) if snapshot is not None else None

    sections = []
    if delta:
        sections.append("Delta:\n" + "\n".join(delta))
    if prds:
        sections.append("Open PRDs:\n" + "\n".join(prds))
    if needs_human:
        sections.append("Needs human:\n" + "\n".join(needs_human))
    if other_sessions:
        sections.append("Other live sessions:\n" + "\n".join(other_sessions))
    if claimed:
        sections.append(claimed)
    if by_hand:
        sections.append(by_hand)

    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(
        payload, "brief" if sections else "none", prds=len(prds), needs_human=len(needs_human),
        other_sessions=len(other_sessions), by_hand=1 if by_hand else 0,
        delta=len(delta), claimed=1 if claimed else 0))
    if not sections:
        return

    msg = f"[{_hook.HOOK_NAME}] " + "\n\n".join(sections)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": msg,
        }
    }))


if __name__ == "__main__":
    main()
