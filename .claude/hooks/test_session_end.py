#!/usr/bin/env python3
import json
import tempfile
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

PRD_CRITERION = "a session is handed the next by-hand ticket"
PRD_ISSUE = {
    "number": 9100,
    "title": "Sessions do not finish",
    "body": "\n".join([
        "## Acceptance criteria",
        "",
        f"- [ ] {PRD_CRITERION} - check: `npm test`",
        "",
    ]),
}
NEEDS_HUMAN_ISSUE = {"number": 9101, "title": "Door stood this one down", "body": ""}
CLAIMED_BY_HAND_ISSUE = {
    "number": 9142,
    "title": "Rewire the workstation symlinks",
    "body": "",
    "assignees": [{"login": LOGIN}],
}
UNCLAIMED_BY_HAND_ISSUE = {
    "number": 9143,
    "title": "Someone else's by-hand ticket",
    "body": "",
    "assignees": [],
}

STUB_BY_LABEL = json.dumps({
    "prd": [PRD_ISSUE],
    "needs-human": [NEEDS_HUMAN_ISSUE],
    "by-hand": [CLAIMED_BY_HAND_ISSUE, UNCLAIMED_BY_HAND_ISSUE],
})

SNAPSHOT_PATH = CWD / ".claude" / "state" / "session-end.json"


def payload():
    return json.dumps({
        "session_id": "sess-end",
        "transcript_path": str(CWD / "transcript.jsonl"),
        "cwd": str(CWD),
        "hook_event_name": "SessionEnd",
        "reason": "clear",
    }).encode()


def drive():
    env = ROWLOG.env(AGENT_SKILLS_GH=str(STUB_GH), STUB_BY_LABEL=STUB_BY_LABEL, STUB_LOGIN=LOGIN)
    run = _harness.run_hook(HOOK, payload(), env=env)
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    assert run.proc.stderr == b"", run.proc.stderr
    return run, ROWLOG.last("session-end")


def main():
    print("## A session end with open spec, needs-human and by-hand issues")
    _run, rows = drive()

    check("writes the snapshot file", SNAPSHOT_PATH.is_file(), str(SNAPSHOT_PATH))
    snapshot = json.loads(SNAPSHOT_PATH.read_text())

    check("names the spec-criteria issue with its criterion sentence",
          any("#9100" in line and PRD_CRITERION in line for line in snapshot["spec_criteria"]),
          str(snapshot["spec_criteria"]))
    check("names the needs-human issue",
          any("#9101" in line for line in snapshot["needs_human"]),
          str(snapshot["needs_human"]))
    check("names both open by-hand issues",
          {"#9142" in line for line in snapshot["by_hand"]} != set()
          and any("#9143" in line for line in snapshot["by_hand"]),
          str(snapshot["by_hand"]))
    check("names only this session's claimed-and-open by-hand ticket",
          any("#9142" in line for line in snapshot["claimed_open_by_hand"])
          and not any("#9143" in line for line in snapshot["claimed_open_by_hand"]),
          str(snapshot["claimed_open_by_hand"]))
    check("writes exactly one run row", len(rows) == 1, str(rows))

    print("\n## Every fire writes its own row")
    for n in range(1, 4):
        _, rows = drive()
        check(f"fire {n}: exactly one row", len(rows) == 1, str(rows))

    finish("session-end: snapshot content and run-row checks all passed.")


if __name__ == "__main__":
    main()
