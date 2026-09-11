#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path

import _hook
import gh_support

GH_TIMEOUT_SECONDS = 10

DETACHED_FLAG = "--detached"
SNAPSHOT_PREFIX = "session-snapshot-"
TRACKED_LABELS = ("prd", "needs-human", "by-hand")
TRACKED_FIELDS = "number,title,state,labels,assignees"


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


def snapshot_path(repo: str) -> Path:
    return _hook.LOG_DIR / f"{SNAPSHOT_PREFIX}{repo.replace('/', '__')}.json"


def open_issues(gh, cwd: str, label: str, *, assignee: str | None = None) -> list[dict]:
    args = ["issue", "list", "--label", label, "--state", "open", "--json", TRACKED_FIELDS]
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


def tracked_tickets(gh, cwd: str) -> list[dict]:
    tickets: dict[int, dict] = {}
    for label in TRACKED_LABELS:
        for issue in open_issues(gh, cwd, label):
            number = issue.get("number")
            if isinstance(number, int):
                tickets[number] = issue
    return [tickets[number] for number in sorted(tickets)]


def claimed_ticket(gh, cwd: str) -> dict | None:
    claimed = sorted(
        open_issues(gh, cwd, "by-hand", assignee="@me"),
        key=lambda issue: issue.get("number") or 0,
    )
    return claimed[0] if claimed else None


def build_snapshot(gh, repo: str, cwd: str, session_id: str) -> dict:
    return {
        "repo": repo,
        "session_id": session_id,
        "tickets": tracked_tickets(gh, cwd),
        "claimed": claimed_ticket(gh, cwd),
    }


def write_snapshot(repo: str, data: dict) -> None:
    path = snapshot_path(repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def run_detached(cwd: str, session_id: str) -> None:
    gh_path = gh_support.gh_bin()
    if gh_path is None:
        return
    gh = gh_support.bind_gh(gh_path, timeout=GH_TIMEOUT_SECONDS)
    repo = resolve_repo(gh, cwd)
    if repo is None:
        return
    repo_gh = gh_support.bind_gh(gh_path, repo, timeout=GH_TIMEOUT_SECONDS)
    write_snapshot(repo, build_snapshot(repo_gh, repo, cwd, session_id))


def spawn_detached(cwd: str, session_id: str) -> None:
    script = str(Path(__file__).resolve())
    try:
        subprocess.Popen(
            [sys.executable, script, DETACHED_FLAG, cwd, session_id],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
        )
    except OSError:
        pass


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == DETACHED_FLAG:
        cwd = sys.argv[2] if len(sys.argv) > 2 else "."
        session_id = sys.argv[3] if len(sys.argv) > 3 else ""
        run_detached(cwd, session_id)
        return

    payload, _ok = _hook.read_payload()
    cwd = payload.get("cwd") or "."
    spawn_detached(cwd, payload.get("session_id") or "")
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(payload, "spawned"))


if __name__ == "__main__":
    main()
