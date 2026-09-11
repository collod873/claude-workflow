#!/usr/bin/env python3
import json
from pathlib import Path

import _hook
import gh_support
import ticket_shape

GH_TIMEOUT_SECONDS = 10

STATE_SUBDIR = Path(".claude") / "state"
SNAPSHOT_FILENAME = "session-end.json"


def issue_line(issue: dict) -> str:
    number = issue.get("number")
    blocks = ticket_shape.criteria_blocks(issue.get("body", "") or "")
    sentence = None
    if blocks:
        text = ticket_shape.CRITERIA_ITEM_RE.sub("", blocks[0], count=1).strip()
        sentence = ticket_shape.CHECK_MARKER_RE.sub("", text).strip()
    return f"#{number}: {sentence or (issue.get('title') or '')}"


def issues_for(gh, cwd: str, label: str, *, assignee: str | None = None) -> list[dict]:
    args = ["issue", "list", "--label", label, "--state", "open", "--json", "number,title,body"]
    if assignee:
        args += ["--assignee", assignee]
    try:
        raw = gh_support.run_gh(gh, *args, cwd=cwd)
    except gh_support.GhError:
        return []
    try:
        issues = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(issues, list):
        return []
    return [issue for issue in issues if isinstance(issue, dict)]


def snapshot(gh, cwd: str, session_id: str) -> dict:
    return {
        "session_id": session_id,
        "spec_criteria": [issue_line(i) for i in issues_for(gh, cwd, "prd")],
        "needs_human": [issue_line(i) for i in issues_for(gh, cwd, "needs-human")],
        "by_hand": [issue_line(i) for i in issues_for(gh, cwd, "by-hand")],
        "claimed_open_by_hand": [
            issue_line(i) for i in issues_for(gh, cwd, "by-hand", assignee="@me")
        ],
    }


def write_snapshot(cwd: str, data: dict) -> bool:
    try:
        state_dir = Path(cwd) / STATE_SUBDIR
        state_dir.mkdir(parents=True, exist_ok=True)
        (state_dir / SNAPSHOT_FILENAME).write_text(json.dumps(data, indent=2) + "\n")
    except OSError:
        return False
    return True


def main() -> None:
    payload, _ok = _hook.read_payload()
    cwd = payload.get("cwd") or "."

    gh_path = gh_support.gh_bin()
    if gh_path is None:
        _hook.append_log(_hook.HOOK_NAME, _hook.run_row(payload, "gh-not-found"))
        return

    gh = gh_support.bind_gh(gh_path, timeout=GH_TIMEOUT_SECONDS)
    data = snapshot(gh, cwd, payload.get("session_id") or "")

    if not write_snapshot(cwd, data):
        _hook.append_log(_hook.HOOK_NAME, _hook.run_row(payload, "write-failed"))
        return

    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(payload, "snapshot"))


if __name__ == "__main__":
    main()
