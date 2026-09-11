#!/usr/bin/env python3
import json
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("session-brief.py")
ROWLOG = _harness.RowLog("session-brief-log-")

STUB_DIR = Path(tempfile.mkdtemp(prefix="session-brief-stub-"))
STUB_GH = STUB_DIR / "gh"
STUB_GH.write_text(
    "#!/usr/bin/env python3\n"
    "import json, os, re, sys\n"
    "argv = sys.argv[1:]\n"
    "joined = ' '.join(argv)\n"
    "def flag(name):\n"
    "    if name in argv:\n"
    "        i = argv.index(name)\n"
    "        if i + 1 < len(argv):\n"
    "            return argv[i + 1]\n"
    "    return None\n"
    "if argv[:2] == ['repo', 'view']:\n"
    "    print(json.dumps({'nameWithOwner': os.environ.get('STUB_REPO', 'acme/widgets')}))\n"
    "elif argv[:1] == ['api'] and '/sub_issues' in joined:\n"
    "    m = re.search(r'/issues/(\\d+)/sub_issues', joined)\n"
    "    table = json.loads(os.environ.get('STUB_CHILDREN', '{}'))\n"
    "    print(json.dumps(table.get(m.group(1), []) if m else []))\n"
    "elif argv[:1] == ['api'] and '/dependencies/blocked_by' in joined:\n"
    "    m = re.search(r'/issues/(\\d+)/dependencies/blocked_by', joined)\n"
    "    table = json.loads(os.environ.get('STUB_BLOCKED', '{}'))\n"
    "    print(json.dumps(table.get(m.group(1), []) if m else []))\n"
    "elif argv[:1] == ['api'] and '/comments' in joined:\n"
    "    m = re.search(r'/issues/(\\d+)/comments', joined)\n"
    "    table = json.loads(os.environ.get('STUB_COMMENTS', '{}'))\n"
    "    print(json.dumps(table.get(m.group(1), []) if m else []))\n"
    "elif argv[:2] == ['issue', 'list']:\n"
    "    table = json.loads(os.environ.get('STUB_BY_LABEL', '{}'))\n"
    "    print(json.dumps(table.get(flag('--label') or '', [])))\n"
    "else:\n"
    "    print('{}')\n"
)
STUB_GH.chmod(0o755)

CWD = Path(tempfile.mkdtemp(prefix="session-brief-cwd-"))

FIRST_CRITERION = "Opening a fresh session hands me the next by-hand ticket"
FIRST_CHECK = "npm run lane-map"
SECOND_CRITERION = "A found gap is filed under a parent criterion or dropped"

ISSUE_BODY = "\n".join([
    "## Acceptance criteria",
    "",
    f"- [ ] {FIRST_CRITERION} - check: `{FIRST_CHECK}`",
    f"- [ ] {SECOND_CRITERION} - check: `npm test`",
    "",
])
ISSUE = {"number": 501, "title": "a spec", "state": "open", "body": ISSUE_BODY}

REFUSAL_REASON = "the claim names the immutable set"
REFUSAL_COMMENT = f"Refused at the to-build door: {REFUSAL_REASON}."
NEEDS_HUMAN_ISSUE = {"number": 701, "title": "wire the symlinks", "state": "open", "body": ""}

ASSIGNED_BY_HAND_ISSUE = {
    "number": 709, "title": "relink the settings file", "state": "open",
    "body": "", "assignees": [{"login": "someone-else"}],
}
BLOCKED_BY_HAND_ISSUE = {
    "number": 711, "title": "rewire the dotfiles", "state": "open",
    "body": "", "assignees": [],
}
READY_BY_HAND_ISSUE = {
    "number": 712, "title": "move the run rows", "state": "open",
    "body": "", "assignees": [],
}

STUB_BY_LABEL = json.dumps({
    "prd": [ISSUE],
    "needs-human": [NEEDS_HUMAN_ISSUE],
    "by-hand": [ASSIGNED_BY_HAND_ISSUE, BLOCKED_BY_HAND_ISSUE, READY_BY_HAND_ISSUE],
})
STUB_COMMENTS = json.dumps({"701": [{"body": REFUSAL_COMMENT}]})
STUB_BLOCKED = json.dumps({"711": [{"number": 799, "state": "open"}]})


def payload(session_id: str = "sess-brief"):
    return json.dumps({
        "session_id": session_id,
        "cwd": str(CWD),
        "hook_event_name": "SessionStart",
        "source": "startup",
    }).encode()


def drive(children="{}", by_label="{}", comments="{}", blocked="{}", session_id="sess-brief"):
    env = ROWLOG.env(AGENT_SKILLS_GH=str(STUB_GH), STUB_REPO="acme/widgets",
                     STUB_CHILDREN=children, STUB_BY_LABEL=by_label,
                     STUB_COMMENTS=comments, STUB_BLOCKED=blocked)
    run = _harness.run_hook(HOOK, payload(session_id), env=env)
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    assert run.proc.stderr == b"", run.proc.stderr
    return run.proc.stdout.decode(), ROWLOG.last("session-brief")


def main():
    print("## One open prd issue, no needs-human or by-hand issues")
    out, rows = drive(by_label=json.dumps({"prd": [ISSUE]}),
                      children=json.dumps({"501": [{"state": "open"}, {"state": "closed"}]}))
    check("prints the first criterion's sentence", FIRST_CRITERION in out, out)
    check("check: marker is stripped", "check:" not in out and FIRST_CHECK not in out, out)
    check("only the first criterion is printed", SECOND_CRITERION not in out, out)
    check("names the child counts", "1 open" in out and "1 closed" in out, out)
    check("writes exactly one run row", len(rows) == 1, str(rows))

    print("\n## No open prd issue")
    out, rows = drive()
    check("prints nothing", out.strip() == "", out)
    check("still writes a run row", len(rows) == 1, str(rows))

    print("\n## Every fire writes its own row")
    for n in range(1, 4):
        _, rows = drive(by_label=json.dumps({"prd": [ISSUE]}))
        check(f"fire {n}: exactly one row", len(rows) == 1, str(rows))

    print("\n## A needs-human issue names itself and its refusal reason")
    out, _rows = drive(by_label=json.dumps({"needs-human": [NEEDS_HUMAN_ISSUE]}),
                       comments=STUB_COMMENTS)
    check("names the needs-human issue with its refusal reason",
          "#701" in out and REFUSAL_REASON in out, out)

    print("\n## A blocked and an assigned by-hand issue are both skipped")
    out, _rows = drive(by_label=STUB_BY_LABEL, blocked=STUB_BLOCKED)
    check("names only the unblocked, unassigned by-hand ticket",
          "#712" in out and "#711" not in out and "#709" not in out, out)
    screen = json.loads(out).get("systemMessage") or ""
    check("puts the by-hand ticket on screen as one line",
          "#712" in screen and "\n" not in screen and screen.startswith("[session-brief]"), screen)

    print("\n## A brief with nothing to act on stays off screen")
    out, _rows = drive(by_label=json.dumps({"prd": [ISSUE]}))
    check("no systemMessage when only a prd is open", "systemMessage" not in json.loads(out), out)

    print("\n## A second live session in this repository is named, a lone session names none")
    env = ROWLOG.env(AGENT_SKILLS_GH=str(STUB_GH), STUB_REPO="acme/widgets")
    shared_log_dir = env["STOP_GATE_LOG_DIR"]
    run_a = _harness.run_hook(HOOK, payload("sess-brief-a"), env=env)
    assert run_a.proc.returncode == 0, run_a.proc.stderr
    run_b = _harness.run_hook(HOOK, payload("sess-brief-b"),
                              env=dict(env, STOP_GATE_LOG_DIR=shared_log_dir))
    assert run_b.proc.returncode == 0, run_b.proc.stderr
    out_b = run_b.proc.stdout.decode()
    check("names the other live session", "sess-brief-a" in out_b, out_b)

    lone_out, _rows = drive(session_id="sess-brief-alone")
    check("names no other live session when alone", "sess-brief-alone" not in lone_out, lone_out)

    finish("session-brief: criterion, needs-human, by-hand, live-session and run-row checks all passed.")


if __name__ == "__main__":
    main()
