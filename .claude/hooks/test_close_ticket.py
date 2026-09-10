#!/usr/bin/env python3
import importlib.util
import json
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS = Path(__file__).resolve().parent
REPO = next((c for c in (HOOKS.parent, HOOKS.parent.parent) if (c / "bin").is_dir()), HOOKS.parent)
BIN = REPO / "bin"
CLOSE_TICKET = BIN / "close-ticket"
STUB_GH = HOOKS / "stub_gh.py"

_spec = importlib.util.spec_from_file_location("close_gate", HOOKS / "close-gate.py")
close_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(close_gate)



TICKET_BODY_ALL_PASS = (
    "## Acceptance criteria\n\n"
    "- [ ] first check passes - check: `true`\n"
    "- [ ] second check passes - check: `true`\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_MIXED = (
    "## Acceptance criteria\n\n"
    "- [ ] this one is checked - check: `true`\n"
    "- [ ] this one is plain prose\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_FAILING = (
    "## Acceptance criteria\n\n"
    "- [ ] this one is broken - check: `sh -c 'echo boom-output; exit 3'`\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_NO_HEADING = "Just a task. No acceptance criteria here at all.\n"

TICKET_BODY_UNPARSEABLE_CHECK = (
    "## Acceptance criteria\n\n"
    "- [ ] first check passes - check: `true`\n"
    "- [ ] check: grep -q needle haystack.txt\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_ALL_UNVERIFIED = (
    "## Acceptance criteria\n\n"
    "- [ ] this one is plain prose\n"
    "- [ ] so is this one\n\n"
    "## Files claimed\n\n- None, no files.\n"
)


def failing_criterion_body(command: str) -> str:
    return (
        "## Acceptance criteria\n\n"
        f"- [ ] gets fixed - check: `{command}`\n\n"
        "## Files claimed\n\n- None, no files.\n"
    )


SPEC_BODY = (
    "## Problem Statement\n\nIt doesn't work.\n\n"
    "## Acceptance criteria\n\n"
    "- [ ] I can see a green deploy on the dashboard - check: `echo deploy-271-green`\n"
)

SPEC_BODY_SILENT = (
    "## Problem Statement\n\nIt doesn't work.\n\n"
    "## Acceptance criteria\n\n"
    "- [ ] I can see a green deploy on the dashboard - check: "
    "`printf '' | xargs -r -I{} echo {}`\n"
)

SPEC_BODY_RED = (
    "## Problem Statement\n\nIt doesn't work.\n\n"
    "## Acceptance criteria\n\n"
    "- [ ] I can see a green deploy on the dashboard - check: `sh -c 'echo not-live; exit 1'`\n"
)

REPO_JSON = json.dumps({"nameWithOwner": "acme/widgets"})


def sub_issues(*children) -> str:
    nodes = []
    for number, state, reason, closer in children:
        if closer is None or closer[0] != "PullRequest":
            prs = []
        else:
            prs = [{"number": closer[1], "merged": closer[2]}]
        nodes.append({"number": number, "state": state, "stateReason": reason,
                      "closedByPullRequestsReferences": {"nodes": prs}})
    return json.dumps({"data": {"repository": {"issue": {"subIssues": {"nodes": nodes}}}}})


DELIVERED_CHILDREN = sub_issues(
    (11, "CLOSED", "COMPLETED", ("PullRequest", 101, True)),
    (12, "CLOSED", "COMPLETED", ("PullRequest", 102, True)),
)




ROWLOG = _harness.RowLog("close-ticket-log-")


def run_cli(args, env_extra=None):
    env = ROWLOG.env()
    env["AGENT_SKILLS_GH"] = str(STUB_GH)
    if env_extra:
        env.update(env_extra)
    argv = [sys.executable, str(CLOSE_TICKET), *args]
    return subprocess.run(argv, capture_output=True, text=True, env=env)


def read_log(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()]


def git_checkout(path: Path, commits: int = 1) -> tuple[Path, str, str]:
    path.mkdir(parents=True, exist_ok=True)
    ident = [
        "-c", "user.name=close-ticket tests", "-c", "user.email=tests@example.invalid",
        "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main",
    ]

    def git(*args: str) -> str:
        r = subprocess.run(["git", *ident, *args], cwd=path, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"git {' '.join(args)} failed in {path}: {r.stderr.strip()}")
        return r.stdout.strip()

    git("init", "-q")
    shas = []
    for n in range(commits):
        (path / f"file-{n}.txt").write_text(f"{n}\n")
        git("add", "-A")
        git("commit", "-q", "--no-gpg-sign", "-m", f"commit {n}")
        shas.append(git("rev-parse", "HEAD"))
    return path, shas[0], shas[-1]




def test_all_criteria_pass(tmp: Path):
    print("all criteria carry a passing check")
    checkout = tmp / "checkout-all-pass"
    checkout.mkdir()
    log = tmp / "log-all-pass.jsonl"
    r = run_cli(
        ["501", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_ALL_PASS}), "STUB_ARGV_LOG": str(log)},
    )
    check("all-pass: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")

    rows = read_log(log)
    argvs = [row["argv"] for row in rows]
    check("all-pass: four gh calls: view, closing-pr probe, comment, close", len(argvs) == 4, argvs)
    if len(argvs) == 4:
        check("all-pass: view first", argvs[0][:2] == ["issue", "view"], argvs[0])
        check("all-pass: record posted before the close is attempted",
              argvs[2][:2] == ["issue", "comment"] and argvs[3][:2] == ["issue", "close"], argvs)
        check("all-pass: view/comment/close all name issue 501",
              all(a[2] == "501" for a in (argvs[0], argvs[2], argvs[3])), argvs)

    check("all-pass: summary line: 2 of 2 verified, 0 unverified",
          "2 of 2 criteria verified · 0 unverified" in r.stdout, r.stdout)
    check("all-pass: no UNVERIFIED bullet", "UNVERIFIED" not in r.stdout, r.stdout)
    check("all-pass: both criteria recorded MET with the command and exit 0",
          r.stdout.count("(MET: `true` exit 0)") == 2, r.stdout)


def test_mixed_checked_and_unchecked(tmp: Path):
    print("a mix of checked and unchecked criteria")
    checkout = tmp / "checkout-mixed"
    checkout.mkdir()
    log = tmp / "log-mixed.jsonl"
    r = run_cli(
        ["502", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_MIXED}), "STUB_ARGV_LOG": str(log)},
    )
    check("mixed: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("mixed: summary line: 1 of 2 verified, 1 unverified",
          "1 of 2 criteria verified · 1 unverified" in r.stdout, r.stdout)

    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("- ")]
    check("mixed: one bullet per criterion, in body order", len(lines) == 2, lines)
    if len(lines) == 2:
        check("mixed: first bullet MET, no leftover checkbox prefix",
              lines[0] == "- this one is checked (MET: `true` exit 0)", lines[0])
        check("mixed: second bullet UNVERIFIED: no check",
              lines[1] == "- this one is plain prose (UNVERIFIED: no check)", lines[1])

    argvs = [row["argv"] for row in read_log(log)]
    check("mixed: still posts and closes", len(argvs) == 4, argvs)


def test_failing_check_aborts(tmp: Path):
    print("a failing check aborts before anything is posted")
    checkout = tmp / "checkout-failing"
    checkout.mkdir()
    log = tmp / "log-failing.jsonl"
    r = run_cli(
        ["503", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_FAILING}), "STUB_ARGV_LOG": str(log)},
    )
    check("failing: exits non-zero", r.returncode != 0, r.returncode)
    check("failing: names the failing criterion on stderr",
          "this one is broken" in r.stderr, r.stderr)
    check("failing: the command's output reaches stderr",
          "boom-output" in r.stderr, r.stderr)
    check("failing: nothing printed to stdout (no record)", r.stdout == "", r.stdout)

    rows = read_log(log)
    argvs = [row["argv"] for row in rows]
    check("failing: only the view call and the closing-pr probe happened; nothing commented, nothing closed",
          [a[:2] for a in argvs] == [["issue", "view"], ["repo", "view"]], argvs)


def test_rerun_after_fix(tmp: Path):
    print("re-running after the work is fixed posts the record and closes")
    checkout = tmp / "checkout-rerun"
    checkout.mkdir()

    log1 = tmp / "log-rerun-1.jsonl"
    r1 = run_cli(
        ["504", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": failing_criterion_body("false")}),
                   "STUB_ARGV_LOG": str(log1)},
    )
    check("rerun/first: exits non-zero", r1.returncode != 0, r1.returncode)
    rows1 = [row["argv"] for row in read_log(log1)]
    check("rerun/first: never commented or closed",
          [a[:2] for a in rows1] == [["issue", "view"], ["repo", "view"]], rows1)

    log2 = tmp / "log-rerun-2.jsonl"
    r2 = run_cli(
        ["504", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": failing_criterion_body("true")}),
                   "STUB_ARGV_LOG": str(log2)},
    )
    check("rerun/second: exits 0 after the fix", r2.returncode == 0,
          f"rc={r2.returncode} stderr={r2.stderr}")
    rows2 = [row["argv"] for row in read_log(log2)]
    check("rerun/second: posts and closes",
          len(rows2) == 4 and rows2[2][:2] == ["issue", "comment"]
          and rows2[3][:2] == ["issue", "close"], rows2)


def test_no_diff_form(tmp: Path):
    print("a criteria-less body over an empty range closes on the 'No diff.' form")
    checkout, base, head = git_checkout(tmp / "checkout-no-diff", commits=2)
    log = tmp / "log-no-diff.jsonl"
    r = run_cli(
        ["505", f"{head}..{head}", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_NO_HEADING}), "STUB_ARGV_LOG": str(log)},
    )
    check("no-diff: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("no-diff: record is exactly the No diff. form",
          r.stdout == "## Closing record\n\nNo diff.\n", r.stdout)

    argvs = [row["argv"] for row in read_log(log)]
    check("no-diff: still posts and closes", len(argvs) == 3, argvs)
    check("no-diff: record posted before close",
          argvs[1][:2] == ["issue", "comment"] and argvs[2][:2] == ["issue", "close"], argvs)
    check("no-diff: the empty range is the one that was handed in", base != head, (base, head))


def test_no_diff_refused_over_a_range_carrying_commits(tmp: Path):
    print("a criteria-less body over a range carrying commits posts nothing and closes nothing")
    checkout, base, head = git_checkout(tmp / "checkout-real-diff", commits=2)
    log = tmp / "log-real-diff.jsonl"
    r = run_cli(
        ["283", f"{base}..{head}", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_NO_HEADING}),
                   "STUB_ARGV_LOG": str(log)},
    )
    check("real-diff: exits non-zero", r.returncode != 0, r.returncode)
    check("real-diff: nothing printed to stdout, no record", r.stdout == "", r.stdout)
    check("real-diff: names the range on stderr", f"{base}..{head}" in r.stderr, r.stderr)
    check("real-diff: names the count on stderr", "carries 1 commit" in r.stderr, r.stderr)

    argvs = [row["argv"] for row in read_log(log)]
    check("real-diff: only the view call happened; nothing commented, nothing closed",
          argvs == [["issue", "view", "283", "--json", "body"]], argvs)


def test_no_diff_refused_when_the_range_cannot_be_counted(tmp: Path):
    print("a range git cannot count refuses rather than falling back to 'No diff.'")
    checkout = tmp / "checkout-uncountable"
    checkout.mkdir()
    log = tmp / "log-uncountable.jsonl"
    r = run_cli(
        ["507", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_NO_HEADING}),
                   "STUB_ARGV_LOG": str(log)},
    )
    check("uncountable: exits non-zero", r.returncode != 0, r.returncode)
    check("uncountable: nothing printed to stdout, no record", r.stdout == "", r.stdout)
    check("uncountable: says it could not count the range",
          "could not count the commits in aaa1111..bbb2222" in r.stderr, r.stderr)

    argvs = [row["argv"] for row in read_log(log)]
    check("uncountable: only the view call happened",
          argvs == [["issue", "view", "507", "--json", "body"]], argvs)


def test_record_satisfies_close_gate_grammar(tmp: Path):
    print("the generated record satisfies close-gate.py's RANGE_LINE_RE and BULLET_RE")
    checkout = tmp / "checkout-grammar"
    checkout.mkdir()
    log = tmp / "log-grammar.jsonl"
    r = run_cli(
        ["506", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_MIXED}), "STUB_ARGV_LOG": str(log)},
    )
    check("grammar: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")

    record = r.stdout
    range_match = close_gate.RANGE_LINE_RE.search(record)
    check("grammar: RANGE_LINE_RE finds the range line",
          bool(range_match) and range_match.group(1) == "aaa1111" and range_match.group(2) == "bbb2222",
          record)

    bullets = close_gate.BULLET_RE.findall(record)
    check("grammar: BULLET_RE finds exactly one bullet per criterion", len(bullets) == 2, bullets)

    summary_line = next(ln for ln in record.splitlines() if "criteria verified" in ln)
    check("grammar: the summary line does not itself match BULLET_RE",
          not close_gate.BULLET_RE.match(summary_line), summary_line)


def test_check_runs_in_checkout(tmp: Path):
    print("a criterion's check runs with the checkout as its cwd, never the invoking tree")
    checkout = tmp / "checkout-cwd"
    checkout.mkdir()
    log = tmp / "log-cwd.jsonl"
    body = (
        "## Acceptance criteria\n\n"
        f"- [ ] runs where it should - check: `{shlex.quote(sys.executable)} {shlex.quote(str(STUB_GH))}`\n\n"
        "## Files claimed\n\n- None, no files.\n"
    )
    r = run_cli(
        ["507", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": body}), "STUB_ARGV_LOG": str(log)},
    )
    check("cwd: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")

    rows = read_log(log)
    check_rows = [row for row in rows if row["argv"] == []]
    gh_rows = [row for row in rows if row["argv"] != []]
    check("cwd: the check's own invocation was logged exactly once", len(check_rows) == 1, rows)
    if check_rows:
        check("cwd: the check ran with the checkout as its cwd",
              Path(check_rows[0]["cwd"]).resolve() == checkout.resolve(), check_rows[0])
    check("cwd: no gh call ran with the checkout as its cwd",
          all(Path(row["cwd"]).resolve() != checkout.resolve() for row in gh_rows), gh_rows)


TICKET_BODY_SUPERSEDABLE = (
    "## Acceptance criteria\n\n"
    "- [ ] first criterion\n"
    "- [ ] second criterion\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_ONE_CRITERION = (
    "## Acceptance criteria\n\n- [ ] only criterion\n\n## Files claimed\n\n- None, no files.\n"
)


def test_superseded_by_open_successor(tmp: Path):
    print("--superseded-by an open successor: posts the third form and closes")
    checkout = tmp / "checkout-superseded-open"
    checkout.mkdir()
    log = tmp / "log-superseded-open.jsonl"
    r = run_cli(
        ["509", "aaa1111..bbb2222", str(checkout), "--superseded-by", "152",
         "--moved", "#152 criterion 1", "--dropped", "no longer relevant"],
        env_extra={
            "STUB_JSON_BY_ISSUE": json.dumps({
                "509": {"body": TICKET_BODY_SUPERSEDABLE},
                "152": {"state": "OPEN"},
            }),
            "STUB_ARGV_LOG": str(log),
        },
    )
    check("superseded-open: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("superseded-open: SUPERSEDED_RE finds the successor line",
          close_gate.SUPERSEDED_RE.search(r.stdout) is not None, r.stdout)

    bullets = [ln for ln in r.stdout.splitlines() if ln.startswith("- ")]
    check("superseded-open: one bullet per criterion", len(bullets) == 2, bullets)
    check("superseded-open: every bullet carries a MOVED or DROPPED disposition",
          bullets and all("MOVED:" in b or "DROPPED:" in b for b in bullets), bullets)
    check("superseded-open: first bullet MOVED, second DROPPED, body order preserved",
          bullets == [
              "- first criterion (MOVED: #152 criterion 1)",
              "- second criterion (DROPPED: no longer relevant)",
          ], bullets)

    argvs = [row["argv"] for row in read_log(log)]
    check("superseded-open: four gh calls: view ticket, view successor, comment, close",
          len(argvs) == 4, argvs)
    if len(argvs) == 4:
        check("superseded-open: successor state read via `gh issue view <n> --json state`",
              argvs[1] == ["issue", "view", "152", "--json", "state"], argvs[1])
        check("superseded-open: record posted before the close is attempted",
              argvs[2][:2] == ["issue", "comment"] and argvs[3][:2] == ["issue", "close"], argvs)
        check("superseded-open: comment/close name the ticket, not the successor",
              argvs[2][2] == "509" and argvs[3][2] == "509", argvs)


def test_superseded_by_closed_successor_refused(tmp: Path):
    print("--superseded-by a closed successor: refused, nothing posted or closed")
    checkout = tmp / "checkout-superseded-closed"
    checkout.mkdir()
    log = tmp / "log-superseded-closed.jsonl"
    r = run_cli(
        ["510", "aaa1111..bbb2222", str(checkout), "--superseded-by", "200",
         "--moved", "#200 criterion 1"],
        env_extra={
            "STUB_JSON_BY_ISSUE": json.dumps({
                "510": {"body": TICKET_BODY_ONE_CRITERION},
                "200": {"state": "CLOSED"},
            }),
            "STUB_ARGV_LOG": str(log),
        },
    )
    check("superseded-closed: exits non-zero", r.returncode != 0, r.returncode)
    check("superseded-closed: names the closed successor on stderr",
          "#200" in r.stderr and "not open" in r.stderr, r.stderr)
    check("superseded-closed: nothing printed to stdout (no record)", r.stdout == "", r.stdout)

    argvs = [row["argv"] for row in read_log(log)]
    check("superseded-closed: never commented or closed",
          all(a[:2] != ["issue", "comment"] and a[:2] != ["issue", "close"] for a in argvs),
          argvs)


def test_superseded_by_unresolvable_successor_refused(tmp: Path):
    print("--superseded-by a successor that doesn't resolve: refused, distinct from closed")
    checkout = tmp / "checkout-superseded-missing"
    checkout.mkdir()
    log = tmp / "log-superseded-missing.jsonl"
    r = run_cli(
        ["511", "aaa1111..bbb2222", str(checkout), "--superseded-by", "999",
         "--moved", "#999 criterion 1"],
        env_extra={
            "STUB_JSON_BY_ISSUE": json.dumps({"511": {"body": TICKET_BODY_ONE_CRITERION}}),
            "STUB_ARGV_LOG": str(log),
        },
    )
    check("superseded-missing: exits non-zero", r.returncode != 0, r.returncode)
    check("superseded-missing: names the unresolvable successor on stderr, not 'not open'",
          "#999" in r.stderr and "could not be resolved" in r.stderr, r.stderr)
    check("superseded-missing: nothing printed to stdout (no record)", r.stdout == "", r.stdout)

    argvs = [row["argv"] for row in read_log(log)]
    check("superseded-missing: never commented or closed",
          all(a[:2] != ["issue", "comment"] and a[:2] != ["issue", "close"] for a in argvs),
          argvs)


def test_superseded_by_reason_count_mismatch_refused(tmp: Path):
    print("--superseded-by with reasons that don't cover every criterion: refused")
    checkout = tmp / "checkout-superseded-mismatch"
    checkout.mkdir()
    log = tmp / "log-superseded-mismatch.jsonl"
    r = run_cli(
        ["512", "aaa1111..bbb2222", str(checkout), "--superseded-by", "152",
         "--moved", "only one reason for two criteria"],
        env_extra={
            "STUB_JSON_BY_ISSUE": json.dumps({
                "512": {"body": TICKET_BODY_SUPERSEDABLE},
                "152": {"state": "OPEN"},
            }),
            "STUB_ARGV_LOG": str(log),
        },
    )
    check("superseded-mismatch: exits non-zero", r.returncode != 0, r.returncode)
    check("superseded-mismatch: stderr names the mismatch",
          "2 acceptance criteria" in r.stderr and "1" in r.stderr, r.stderr)
    check("superseded-mismatch: nothing printed to stdout (no record)", r.stdout == "", r.stdout)

    argvs = [row["argv"] for row in read_log(log)]
    check("superseded-mismatch: never commented or closed",
          all(a[:2] != ["issue", "comment"] and a[:2] != ["issue", "close"] for a in argvs),
          argvs)


def test_repo_flag_carried_through(tmp: Path):
    print("-R is carried through to every gh call")
    checkout = tmp / "checkout-repo-flag"
    checkout.mkdir()
    log = tmp / "log-repo-flag.jsonl"
    r = run_cli(
        ["508", "aaa1111..bbb2222", str(checkout), "-R", "acme/widgets"],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_ALL_PASS}), "STUB_ARGV_LOG": str(log)},
    )
    check("-R: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    argvs = [row["argv"] for row in read_log(log)]
    check("-R: carried on every gh call",
          bool(argvs) and all("-R" in a and a[a.index("-R") + 1] == "acme/widgets" for a in argvs),
          argvs)


def test_run_row(tmp: Path):
    print("one run row per invocation, closed or refused")
    checkout = tmp / "checkout-row"
    checkout.mkdir()
    log = tmp / "log-row.jsonl"
    r = run_cli(
        ["601", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_ALL_PASS}),
                   "STUB_ARGV_LOG": str(log)},
    )
    rows = ROWLOG.last("close-ticket")
    check("a successful close writes one row, verdict=closed",
          r.returncode == 0 and len(rows) == 1 and rows[0].get("verdict") == "closed",
          f"rc={r.returncode} rows={rows}")
    row = rows[0] if rows else {}
    check("the row names the issue and counts the criteria it verified",
          row.get("issue") == "601" and row.get("criteria", 0) > 0
          and row.get("verified") == row.get("criteria"), row)
    check("the row names the tool, not a hook", row.get("tool") == "close-ticket", row)

    r = run_cli(
        ["602", "aaa1111..bbb2222", str(tmp / "checkout-row")],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_FAILING}),
                   "STUB_ARGV_LOG": str(tmp / "log-row-refused.jsonl")},
    )
    rows = ROWLOG.last("close-ticket")
    check("a failing check writes one row, verdict=refused",
          r.returncode != 0 and len(rows) == 1 and rows[0].get("verdict") == "refused",
          f"rc={r.returncode} rows={rows}")
    check("a refusal still names the issue it refused",
          rows and rows[0].get("issue") == "602", str(rows))

    r = run_cli(["603", "not-a-range", str(checkout)])
    rows = ROWLOG.last("close-ticket")
    check("a malformed range refuses before any gh call, and still writes its row",
          r.returncode != 0 and len(rows) == 1 and rows[0].get("verdict") == "refused",
          f"rc={r.returncode} rows={rows}")


def test_unparseable_check_refused(tmp: Path):
    print("a criterion that says `check:` and names nothing runnable is refused, not UNVERIFIED")
    checkout = tmp / "checkout-unparseable"
    checkout.mkdir()
    log = tmp / "log-unparseable.jsonl"
    r = run_cli(
        ["514", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_UNPARSEABLE_CHECK}),
                   "STUB_ARGV_LOG": str(log)},
    )
    check("unparseable: exits non-zero", r.returncode != 0, f"rc={r.returncode}")
    check("unparseable: stderr names the criterion it cannot run",
          "cannot run" in r.stderr, r.stderr)
    check("unparseable: never recorded as UNVERIFIED; that is the bug, not the verdict",
          "UNVERIFIED" not in r.stdout and "UNVERIFIED" not in r.stderr, r.stdout + r.stderr)
    check("unparseable: nothing printed to stdout (no record)", r.stdout == "", r.stdout)

    argvs = [row["argv"] for row in read_log(log)]
    check("unparseable: the body was read and the closing-pr probe ran, nothing else; never commented or closed",
          [a[:2] for a in argvs] == [["issue", "view"], ["repo", "view"]], argvs)


def test_every_criterion_unverified_refused(tmp: Path):
    print("a ticket whose every criterion is unverified does not close on `0 of N`")
    checkout = tmp / "checkout-all-unverified"
    checkout.mkdir()
    log = tmp / "log-all-unverified.jsonl"
    r = run_cli(
        ["515", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_ALL_UNVERIFIED}),
                   "STUB_ARGV_LOG": str(log)},
    )
    check("all-unverified: exits non-zero", r.returncode != 0, f"rc={r.returncode}")
    check("all-unverified: stderr says nothing was checked",
          "every criterion unverified" in r.stderr, r.stderr)
    check("all-unverified: no `0 of 2` record is rendered",
          "0 of 2" not in r.stdout, r.stdout)
    check("all-unverified: nothing printed to stdout (no record)", r.stdout == "", r.stdout)

    argvs = [row["argv"] for row in read_log(log)]
    check("all-unverified: never commented or closed",
          [a[:2] for a in argvs] == [["issue", "view"], ["repo", "view"]], argvs)

    rows = ROWLOG.last("close-ticket")
    check("all-unverified: the refusal still writes its run row",
          len(rows) == 1 and rows[0].get("verdict") == "refused"
          and rows[0].get("issue") == "515", str(rows))


def run_spec(issue: str, tmp: Path, slug: str, body: str, graphql: str):
    checkout = tmp / f"checkout-{slug}"
    checkout.mkdir(exist_ok=True)
    log = tmp / f"log-{slug}.jsonl"
    r = run_cli(
        [issue, "aaa1111..bbb2222", str(checkout), "--spec"],
        env_extra={"STUB_JSON": json.dumps({"body": body}),
                   "STUB_REPO_JSON": REPO_JSON,
                   "STUB_GRAPHQL_JSON": graphql,
                   "STUB_ARGV_LOG": str(log)},
    )
    return r, [row["argv"] for row in read_log(log)]


def test_spec_closes_when_every_child_delivered(tmp: Path):
    print("--spec: every sub-issue delivered and the check green: closes like a ticket")
    r, argvs = run_spec("701", tmp, "spec-green", SPEC_BODY, DELIVERED_CHILDREN)
    check("spec-green: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("spec-green: the same record shape a ticket gets: range, summary, one bullet",
          "1 of 1 criteria verified · 0 unverified" in r.stdout
          and "(MET: `echo deploy-271-green` exit 0)" in r.stdout, r.stdout)
    check("spec-green: the record names the command that was run, not just a verdict",
          "`echo deploy-271-green`" in r.stdout, r.stdout)
    check("spec-green: the record carries what the check printed, not only what it ran",
          "> deploy-271-green" in r.stdout, r.stdout)
    check("spec-green: the quoted output cannot be read as a second bullet",
          len(close_gate.BULLET_RE.findall(r.stdout)) == 1, r.stdout)
    check("spec-green: commented and closed",
          [a[:2] for a in argvs][-2:] == [["issue", "comment"], ["issue", "close"]], argvs)


def test_spec_silent_check_refused(tmp: Path):
    print("--spec: a check that exits 0 having printed nothing is refused, not MET")
    r, argvs = run_spec("707", tmp, "spec-silent", SPEC_BODY_SILENT, DELIVERED_CHILDREN)
    check("spec-silent: exits non-zero", r.returncode != 0, f"rc={r.returncode}")
    check("spec-silent: stderr says the check printed no evidence",
          "printed no evidence" in r.stderr, r.stderr)
    check("spec-silent: stderr names the criterion, not just the command",
          "green deploy on the dashboard" in r.stderr, r.stderr)
    check("spec-silent: nothing printed to stdout (no record)", r.stdout == "", r.stdout)
    check("spec-silent: never commented or closed",
          not any(a[:2] in (["issue", "comment"], ["issue", "close"]) for a in argvs), argvs)


def test_ticket_silent_check_still_met(tmp: Path):
    print("a ticket's check that exits 0 in silence is still MET")
    checkout = tmp / "checkout-quiet"
    checkout.mkdir()
    log = tmp / "log-quiet.jsonl"
    body = (
        "## Acceptance criteria\n\n"
        "- [ ] the marker file exists - check: `test -d .`\n"
    )
    r = run_cli(
        ["708", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": body}),
                   "STUB_REPO_JSON": REPO_JSON,
                   "STUB_ARGV_LOG": str(log)},
    )
    check("ticket-quiet: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("ticket-quiet: MET on a silent exit 0",
          "(MET: `test -d .` exit 0)" in r.stdout, r.stdout)
    check("ticket-quiet: no evidence is quoted into a ticket's record",
          ">" not in r.stdout, r.stdout)


def test_spec_refuses_undelivered_children(tmp: Path):
    print("--spec: a child that is open, hand-closed, not planned, or closed by an unmerged PR")
    cases = [
        ("open", (21, "OPEN", None, None), "still open"),
        ("hand", (22, "CLOSED", "COMPLETED", ("Commit",)), "closed by hand"),
        ("notplanned", (23, "CLOSED", "NOT_PLANNED", ("PullRequest", 103, True)),
         "not planned"),
        ("unmerged", (24, "CLOSED", "COMPLETED", ("PullRequest", 104, False)),
         "not merged"),
    ]
    for slug, child, needle in cases:
        graphql = sub_issues((11, "CLOSED", "COMPLETED", ("PullRequest", 101, True)), child)
        r, argvs = run_spec("702", tmp, f"spec-{slug}", SPEC_BODY, graphql)
        check(f"spec-{slug}: exits non-zero", r.returncode != 0, f"rc={r.returncode}")
        check(f"spec-{slug}: stderr names the undelivered child and why",
              f"#{child[0]}" in r.stderr and needle in r.stderr, r.stderr)
        check(f"spec-{slug}: the delivered sibling is not named as a problem",
              "#11" not in r.stderr, r.stderr)
        check(f"spec-{slug}: nothing posted or closed",
              [a[:2] for a in argvs] == [["issue", "view"], ["repo", "view"],
                                          ["api", "graphql"]], argvs)


def test_spec_precondition_runs_before_any_check(tmp: Path):
    print("--spec: the delivery gate is checked before any check command runs")
    graphql = sub_issues((31, "OPEN", None, None))
    marker = tmp / "spec-check-ran.marker"
    body = (
        "## Acceptance criteria\n\n"
        f"- [ ] the world changed - check: `touch {marker}`\n"
    )
    r, _ = run_spec("703", tmp, "spec-ordering", body, graphql)
    check("spec-ordering: refused on the undelivered child", r.returncode != 0, r.stderr)
    check("spec-ordering: the check command never ran", not marker.exists(),
          f"{marker} exists; render_record ran before the precondition")


def test_spec_red_check_leaves_it_open(tmp: Path):
    print("--spec: children all delivered but the check red: refuses, spec stays open")
    r, argvs = run_spec("704", tmp, "spec-red", SPEC_BODY_RED, DELIVERED_CHILDREN)
    check("spec-red: exits non-zero", r.returncode != 0, f"rc={r.returncode}")
    check("spec-red: stderr carries the failing command's own output",
          "not-live" in r.stderr, r.stderr)
    check("spec-red: nothing printed to stdout (no record)", r.stdout == "", r.stdout)
    check("spec-red: never commented or closed",
          not any(a[:2] in (["issue", "comment"], ["issue", "close"]) for a in argvs), argvs)


def test_spec_with_no_children_passes_the_gate(tmp: Path):
    print("--spec: a spec that was never sliced has nothing undelivered")
    r, _ = run_spec("705", tmp, "spec-childless", SPEC_BODY, sub_issues())
    check("spec-childless: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")


def test_ticket_close_makes_no_sub_issue_calls(tmp: Path):
    print("a plain ticket close never runs the --spec undelivered-children gate")
    checkout = tmp / "checkout-nospec"
    checkout.mkdir()
    log = tmp / "log-nospec.jsonl"
    r = run_cli(
        ["706", "aaa1111..bbb2222", str(checkout)],
        env_extra={"STUB_JSON": json.dumps({"body": TICKET_BODY_ALL_PASS}),
                   "STUB_REPO_JSON": REPO_JSON,
                   "STUB_GRAPHQL_JSON": sub_issues((41, "OPEN", None, None)),
                   "STUB_ARGV_LOG": str(log)},
    )
    argvs = [row["argv"] for row in read_log(log)]
    check("no-spec: exits 0 with an open child the spec gate would have refused",
          r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("no-spec: view, closing-pr probe (repo view + graphql), comment, close and nothing else",
          [a[:2] for a in argvs] == [["issue", "view"], ["repo", "view"], ["api", "graphql"],
                                      ["issue", "comment"], ["issue", "close"]], argvs)


def main():
    with tempfile.TemporaryDirectory(prefix="close-ticket-test-") as tmp_str:
        tmp = Path(tmp_str)
        test_all_criteria_pass(tmp)
        print()
        test_mixed_checked_and_unchecked(tmp)
        print()
        test_failing_check_aborts(tmp)
        print()
        test_rerun_after_fix(tmp)
        print()
        test_no_diff_form(tmp)
        print()
        test_no_diff_refused_over_a_range_carrying_commits(tmp)
        print()
        test_no_diff_refused_when_the_range_cannot_be_counted(tmp)
        print()
        test_record_satisfies_close_gate_grammar(tmp)
        print()
        test_check_runs_in_checkout(tmp)
        print()
        test_superseded_by_open_successor(tmp)
        print()
        test_superseded_by_closed_successor_refused(tmp)
        print()
        test_superseded_by_unresolvable_successor_refused(tmp)
        print()
        test_superseded_by_reason_count_mismatch_refused(tmp)
        print()
        test_repo_flag_carried_through(tmp)
        print()
        test_unparseable_check_refused(tmp)
        print()
        test_every_criterion_unverified_refused(tmp)
        print()
        test_spec_closes_when_every_child_delivered(tmp)
        print()
        test_spec_silent_check_refused(tmp)
        print()
        test_ticket_silent_check_still_met(tmp)
        print()
        test_spec_refuses_undelivered_children(tmp)
        print()
        test_spec_precondition_runs_before_any_check(tmp)
        print()
        test_spec_red_check_leaves_it_open(tmp)
        print()
        test_spec_with_no_children_passes_the_gate(tmp)
        print()
        test_ticket_close_makes_no_sub_issue_calls(tmp)
        print()
        test_run_row(tmp)

    ROWLOG.cleanup()
    finish("All close-ticket checks passed.")


if __name__ == "__main__":
    main()
