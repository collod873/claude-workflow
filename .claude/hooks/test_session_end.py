#!/usr/bin/env python3
import json
import tempfile
import time
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("session-end.py")
ROWLOG = _harness.RowLog("session-end-log-")

STUB_DIR = Path(tempfile.mkdtemp(prefix="session-end-stub-"))
STUB_GH = STUB_DIR / "gh"
STUB_GH.write_text(
    "#!/usr/bin/env python3\n"
    "import json, os, sys\n"
    "argv = sys.argv[1:]\n"
    "def flag(name):\n"
    "    if name in argv:\n"
    "        i = argv.index(name)\n"
    "        if i + 1 < len(argv):\n"
    "            return argv[i + 1]\n"
    "    return None\n"
    "if argv[:2] == ['repo', 'view']:\n"
    "    print(json.dumps({'nameWithOwner': os.environ.get('STUB_REPO', 'acme/workstation')}))\n"
    "    sys.exit(0)\n"
    "table = json.loads(os.environ.get('STUB_BY_LABEL', '{}'))\n"
    "issues = table.get(flag('--label') or '', [])\n"
    "assignee = flag('--assignee')\n"
    "if assignee:\n"
    "    login = os.environ.get('STUB_LOGIN', 'octocat')\n"
    "    who = login if assignee == '@me' else assignee\n"
    "    issues = [i for i in issues if who in [a.get('login') for a in i.get('assignees', [])]]\n"
    "print(json.dumps(issues))\n"
)
STUB_GH.chmod(0o755)

CWD = Path(tempfile.mkdtemp(prefix="session-end-cwd-"))

LOGIN = "octocat"
STUB_REPO = "acme/workstation"

PRD_ISSUE = {
    "number": 9100, "title": "Sessions do not finish", "state": "open",
    "labels": [{"name": "prd"}], "assignees": [], "body": "",
}
NEEDS_HUMAN_ISSUE = {
    "number": 9101, "title": "Door stood this one down", "state": "open",
    "labels": [{"name": "needs-human"}], "assignees": [], "body": "",
}
CLAIMED_BY_HAND_ISSUE = {
    "number": 9142,
    "title": "Rewire the workstation symlinks",
    "state": "open",
    "labels": [{"name": "by-hand"}],
    "assignees": [{"login": LOGIN}],
    "body": "",
}
UNCLAIMED_BY_HAND_ISSUE = {
    "number": 9143,
    "title": "Someone else's by-hand ticket",
    "state": "open",
    "labels": [{"name": "by-hand"}],
    "assignees": [],
    "body": "",
}

STUB_BY_LABEL = json.dumps({
    "prd": [PRD_ISSUE],
    "needs-human": [NEEDS_HUMAN_ISSUE],
    "by-hand": [CLAIMED_BY_HAND_ISSUE, UNCLAIMED_BY_HAND_ISSUE],
})

SNAPSHOT_NAME = f"session-snapshot-{STUB_REPO.replace('/', '__')}.json"
SNAPSHOT_WAIT_SECONDS = 20


def payload():
    return json.dumps({
        "session_id": "sess-end",
        "transcript_path": str(CWD / "transcript.jsonl"),
        "cwd": str(CWD),
        "hook_event_name": "SessionEnd",
        "reason": "clear",
    }).encode()


def drive():
    env = ROWLOG.env(AGENT_SKILLS_GH=str(STUB_GH), STUB_BY_LABEL=STUB_BY_LABEL,
                     STUB_LOGIN=LOGIN, STUB_REPO=STUB_REPO)
    log_dir = ROWLOG.root / str(ROWLOG.n)
    run = _harness.run_hook(HOOK, payload(), env=env)
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    assert run.proc.stderr == b"", run.proc.stderr
    snapshot_path = log_dir / SNAPSHOT_NAME
    deadline = time.monotonic() + SNAPSHOT_WAIT_SECONDS
    while not snapshot_path.is_file() and time.monotonic() < deadline:
        time.sleep(0.1)
    return run, ROWLOG.last("session-end"), snapshot_path


def main():
    print("## A session end with open spec, needs-human and by-hand issues")
    _run, rows, snapshot_path = drive()

    check("writes the snapshot file", snapshot_path.is_file(), str(snapshot_path))
    snapshot = json.loads(snapshot_path.read_text())
    numbers = {ticket.get("number") for ticket in snapshot.get("tickets", [])}

    check("names the spec-criteria issue", 9100 in numbers, str(numbers))
    check("names the needs-human issue", 9101 in numbers, str(numbers))
    check("names both open by-hand issues", {9142, 9143} <= numbers, str(numbers))
    claimed = snapshot.get("claimed") or {}
    check("names only this session's claimed-and-open by-hand ticket",
          claimed.get("number") == 9142, str(claimed))
    check("writes exactly one run row", len(rows) == 1, str(rows))

    print("\n## Every fire writes its own row")
    for n in range(1, 4):
        _, rows, _ = drive()
        check(f"fire {n}: exactly one row", len(rows) == 1, str(rows))

    finish("session-end: snapshot content and run-row checks all passed.")


if __name__ == "__main__":
    main()
