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
    "if argv[:2] == ['repo', 'view']:\n"
    "    print(json.dumps({'nameWithOwner': os.environ.get('STUB_REPO', 'acme/widgets')}))\n"
    "elif argv[:2] == ['issue', 'list']:\n"
    "    print(os.environ.get('STUB_ISSUES', '[]'))\n"
    "elif argv[:1] == ['api'] and argv[1].endswith('/sub_issues'):\n"
    "    m = re.search(r'/issues/(\\d+)/sub_issues$', argv[1])\n"
    "    table = json.loads(os.environ.get('STUB_CHILDREN', '{}'))\n"
    "    print(json.dumps(table.get(m.group(1), []) if m else []))\n"
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


def payload():
    return json.dumps({
        "session_id": "sess-brief",
        "cwd": str(CWD),
        "hook_event_name": "SessionStart",
        "source": "startup",
    }).encode()


def drive(issues="[]", children="{}"):
    env = ROWLOG.env(AGENT_SKILLS_GH=str(STUB_GH), STUB_REPO="acme/widgets",
                     STUB_ISSUES=issues, STUB_CHILDREN=children)
    run = _harness.run_hook(HOOK, payload(), env=env)
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    assert run.proc.stderr == b"", run.proc.stderr
    return run.proc.stdout.decode(), ROWLOG.last("session-brief")


def main():
    print("## One open prd issue")
    out, rows = drive(issues=json.dumps([ISSUE]),
                      children=json.dumps({"501": [{"state": "open"}, {"state": "closed"}]}))
    check("prints the first criterion's sentence", FIRST_CRITERION in out, out)
    check("check: marker is stripped", "check:" not in out and FIRST_CHECK not in out, out)
    check("only the first criterion is printed", SECOND_CRITERION not in out, out)
    check("names the child counts", "1 open" in out and "1 closed" in out, out)
    check("writes exactly one run row", len(rows) == 1, str(rows))

    print("\n## No open prd issue")
    out, rows = drive(issues="[]")
    check("prints nothing", out.strip() == "", out)
    check("still writes a run row", len(rows) == 1, str(rows))

    print("\n## Every fire writes its own row")
    for n in range(1, 4):
        _, rows = drive(issues=json.dumps([ISSUE]))
        check(f"fire {n}: exactly one row", len(rows) == 1, str(rows))

    finish("session-brief: criterion, run-row and child-count checks all passed.")


if __name__ == "__main__":
    main()
