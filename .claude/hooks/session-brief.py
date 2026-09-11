#!/usr/bin/env python3
import json

import _hook
import gh_support
import ticket_shape

GH_TIMEOUT_SECONDS = 10


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


def open_prd_issues(gh, cwd: str) -> list[dict]:
    try:
        raw = gh_support.run_gh(
            gh, "issue", "list", "--label", "prd", "--state", "open",
            "--json", "number,title,body", cwd=cwd,
        )
    except gh_support.GhError:
        return []
    try:
        issues = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return issues if isinstance(issues, list) else []


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


def brief_lines(gh, repo: str, cwd: str) -> list[str]:
    lines = []
    for issue in open_prd_issues(gh, cwd):
        if not isinstance(issue, dict):
            continue
        criterion = first_criterion_sentence(issue.get("body", "") or "")
        if criterion is None:
            continue
        opened, closed = child_counts(gh, repo, issue.get("number"))
        lines.append(f"#{issue.get('number')}: {criterion} ({opened} open, {closed} closed)")
    return lines


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
    lines = brief_lines(repo_gh, repo, cwd)
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(
        payload, "brief" if lines else "none", prds=len(lines)))
    if not lines:
        return

    msg = f"[{_hook.HOOK_NAME}] Open PRDs:\n" + "\n".join(lines)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": msg,
        }
    }))


if __name__ == "__main__":
    main()
