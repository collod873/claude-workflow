#!/usr/bin/env python3
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS = Path(__file__).resolve().parent
REPO = next((c for c in (HOOKS.parent, HOOKS.parent.parent) if (c / "bin").is_dir()), HOOKS.parent)
HOOK = HOOKS / "close-gate.py"
STUB_GH = HOOKS / "stub_gh.py"
CLOSE_TICKET = REPO / "bin" / "close-ticket"

_spec = importlib.util.spec_from_file_location("close_gate", HOOK)
close_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(close_gate)

ENROLLED_CWD = Path(tempfile.mkdtemp(prefix="close-gate-enrolled-"))
subprocess.run(["git", "init", "-q", str(ENROLLED_CWD)], check=True, capture_output=True)
_harness.enroll(ENROLLED_CWD)


def run_hook(payload_bytes, env_extra=None, home=None, timeout=_harness.HOOK_TIMEOUT):
    env = dict(os.environ)
    env.pop("AGENT_SKILLS_GH", None)
    if home is not None:
        env["HOME"] = str(home)
    if env_extra:
        env.update(env_extra)
    return _harness.run_hook(HOOK, payload_bytes, timeout=timeout, env=env).proc


def payload(command, session_id="sess-1", cwd=None):
    return json.dumps({
        "session_id": session_id,
        "cwd": cwd or str(ENROLLED_CWD),
        "hook_event_name": "PreToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": command},
    }).encode()


def parse_stdout_json(stdout_bytes):
    if not stdout_bytes.strip():
        return None
    return json.loads(stdout_bytes.decode())


def is_denied(result):
    out = parse_stdout_json(result.stdout)
    if out is None:
        return False
    hso = out.get("hookSpecificOutput", {})
    return hso.get("permissionDecision") == "deny"


def stub_env(mode="json", body="", comments=None, sleep=None):
    env = {"AGENT_SKILLS_GH": str(STUB_GH), "STUB_MODE": mode}
    if mode == "json":
        env["STUB_JSON"] = json.dumps({"body": body, "comments": comments or []})
    if sleep is not None:
        env["STUB_SLEEP"] = str(sleep)
    return env


def gate_rows(home):
    return _harness.rows(Path(home) / ".claude" / "logs", "close-gate")


def logged(home, verdict, reason=None):
    return any(row.get("verdict") == verdict and (reason is None or row.get("reason") == reason)
               for row in gate_rows(home))


def record(range_decl, bullets):
    body = f"## Closing record\n\n`{range_decl}`\n\n"
    body += "\n".join(f"- {b}" for b in bullets)
    return body


def issue_body(n_criteria):
    lines = "\n".join(f"- [ ] criterion {i}" for i in range(1, n_criteria + 1))
    return f"Part of #29.\n\n## Acceptance criteria\n{lines}\n"


def body_without_criteria():
    return "Part of #29.\n\nSomething to do, written before the ticket shape existed.\n"


def nodiff_record(bullets=()):
    body = "## Closing record\n\nNo diff.\n"
    if bullets:
        body += "\n" + "\n".join(f"- {b}" for b in bullets)
    return body


def superseded_record(successor, bullets, repo=""):
    body = f"## Closing record\n\nSuperseded by {repo}#{successor}.\n\n"
    body += "\n".join(f"- {b}" for b in bullets)
    return body


def successor_env(body, comments, successor, state):
    env = stub_env(body=body, comments=comments)
    env["STUB_JSON_BY_ISSUE"] = json.dumps({str(successor): {"state": state}})
    return env


CLOSE_CMD = 'gh issue close {n} --comment "implemented"'
CLOSE_CMD_HEREDOC = (
    "gh issue close {n} --comment \"$(cat <<'EOF'\n{record}\nEOF\n)\""
)


def run_cases(tmp):
    home1 = tmp / "home1"
    (home1 / ".claude").mkdir(parents=True)
    r = run_hook(payload("git status"), home=home1)
    check("not-a-close: exit 0", r.returncode == 0, f"rc={r.returncode}")
    check("not-a-close: no stdout", r.stdout == b"", repr(r.stdout))
    check("not-a-close: no log row", gate_rows(home1) == [], gate_rows(home1))

    home2 = tmp / "home2"
    (home2 / ".claude").mkdir(parents=True)
    good_record = record("abc1234..def5678", [
        "criterion 1 - MET: `hooks/close-gate.py:42`",
        "criterion 2 - MET: `pytest -q` exit 0",
        "criterion 3 - MET: `hooks/test_close_gate.py:10`",
    ])
    cmd = CLOSE_CMD.format(n=35)
    env = stub_env(body=issue_body(3), comments=[{"body": good_record, "createdAt": "2026-07-29T00:00:00Z"}])
    r = run_hook(payload(cmd), env_extra=env, home=home2)
    check("happy-path: exit 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr!r}")
    out = parse_stdout_json(r.stdout)
    check("happy-path: no permissionDecision field", out is None or "hookSpecificOutput" not in out
          or "permissionDecision" not in out.get("hookSpecificOutput", {}), repr(r.stdout))
    check("happy-path: never allow", not (out and out.get("hookSpecificOutput", {}).get("permissionDecision") == "allow"))
    check("happy-path: log row verdict=allow", logged(home2, "allow"), gate_rows(home2))

    home2b = tmp / "home2b"
    (home2b / ".claude").mkdir(parents=True)
    cmd_nodiff = CLOSE_CMD_HEREDOC.format(n=12, record="## Closing record\n\nNo diff.")
    env = stub_env(body=body_without_criteria(), comments=[])
    r = run_hook(payload(cmd_nodiff), env_extra=env, home=home2b)
    check("no-diff inline: allowed when the body declares no criteria",
          r.returncode == 0 and not is_denied(r), r.stdout)

    home2c = tmp / "home2c"
    (home2c / ".claude").mkdir(parents=True)
    r = run_hook(payload(cmd_nodiff), env_extra={"AGENT_SKILLS_GH": "/nonexistent/gh"}, home=home2c)
    check("no-diff inline: fails closed when gh cannot be reached", is_denied(r), r.stdout)
    check("no-diff inline: unreachable gh logged as degraded",
          logged(home2c, "degraded"), gate_rows(home2c))

    home3 = tmp / "home3"
    (home3 / ".claude").mkdir(parents=True)
    env = stub_env(body=issue_body(2), comments=[])
    r = run_hook(payload(CLOSE_CMD.format(n=1)), env_extra=env, home=home3)
    check("no-record: denied", is_denied(r), r.stdout)
    out = parse_stdout_json(r.stdout)
    check("no-record: hookEventName present", out["hookSpecificOutput"]["hookEventName"] == "PreToolUse")
    reason3 = out["hookSpecificOutput"]["permissionDecisionReason"]
    check("no-record: hands over a filled close-ticket invocation",
          "bin/close-ticket 1 <base>..<head>" in reason3, reason3)
    check("no-record: names the No diff. remedy", "No diff." in reason3, reason3)

    home3b = tmp / "home3b"
    (home3b / ".claude").mkdir(parents=True)
    repo3b = tmp / "repo3b"
    subprocess.run(["git", "init", "-q", str(repo3b)], check=True, capture_output=True, text=True)
    _harness.enroll(repo3b)
    env3b = stub_env(body=issue_body(2), comments=[])
    r3b = run_hook(payload(CLOSE_CMD.format(n=45), cwd=str(repo3b)), env_extra=env3b, home=home3b)
    check("no-record: denied (repo_toplevel case)", is_denied(r3b), r3b.stdout)
    reason3b = parse_stdout_json(r3b.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
    check("no-record: the handed-over checkout is this repo's own toplevel",
          str(repo3b.resolve()) in reason3b, reason3b)

    home3c = tmp / "home3c"
    (home3c / ".claude").mkdir(parents=True)
    r3c = run_hook(
        payload('gh issue close 46 -R other/repo --comment "implemented"', cwd=str(repo3b)),
        env_extra=env3b, home=home3c)
    check("no-record with -R: denied", is_denied(r3c), r3c.stdout)
    reason3c = parse_stdout_json(r3c.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
    check("no-record with -R: bails out instead of guessing the local toplevel",
          str(repo3b.resolve()) not in reason3c
          and "<a checkout of this repo at the range's head>" in reason3c, reason3c)
    check("no-record with -R: the handed-over invocation carries --repo",
          "--repo other/repo" in reason3c, reason3c)

    home4 = tmp / "home4"
    (home4 / ".claude").mkdir(parents=True)
    mismatch_record = record("aaa1111..bbb2222", [
        "c1 - MET: `f.py:1`", "c2 - MET: `f.py:2`", "c3 - MET: `f.py:3`", "c4 - MET: `f.py:4`",
    ])
    env = stub_env(body=issue_body(5), comments=[{"body": mismatch_record, "createdAt": "t"}])
    r = run_hook(payload(CLOSE_CMD.format(n=2)), env_extra=env, home=home4)
    check("count-mismatch: denied", is_denied(r), r.stdout)
    out = parse_stdout_json(r.stdout)
    reason = out["hookSpecificOutput"]["permissionDecisionReason"]
    check("count-mismatch: names the arithmetic", "5" in reason and "4" in reason, reason)

    home5 = tmp / "home5"
    (home5 / ".claude").mkdir(parents=True)
    unverified_record = record("aaa1111..bbb2222", [
        "c1 - UNVERIFIED: no check",
        "c2 - MET: `f.py:1` exit 0",
    ])
    env = stub_env(body=issue_body(2), comments=[{"body": unverified_record, "createdAt": "t"}])
    r = run_hook(payload(CLOSE_CMD.format(n=3)), env_extra=env, home=home5)
    check("UNVERIFIED bullet: allowed", r.returncode == 0 and not is_denied(r), r.stdout)
    check("UNVERIFIED bullet: logged allow", logged(home5, "allow", "met"), gate_rows(home5))

    for tag, n, bullets in [
        ("bare-verdict", 4, ["c1 - MET", "c2 - MET: `f.py:1`"]),
        ("unmet", 14, ["c1 - MET: `f.py:1`", "c2 - UNMET: no evidence yet"]),
        ("not-met", 15, ["c1 - MET: `f.py:1`", "c2 - NOT MET: `f.py:2`"]),
        ("contradicting", 17,
         ["c1 - MET: `f.py:1` - UNMET: the second half never landed", "c2 - MET: `f.py:2`"]),
        ("unrelated-prose", 18, ["whatever I felt like typing", "so did this one"]),
    ]:
        home = tmp / f"home5-{tag}"
        (home / ".claude").mkdir(parents=True)
        env = stub_env(body=issue_body(2),
                       comments=[{"body": record("aaa1111..bbb2222", bullets), "createdAt": "t"}])
        r = run_hook(payload(CLOSE_CMD.format(n=n)), env_extra=env, home=home)
        check(f"bullet content ({tag}) never judged: allowed",
              r.returncode == 0 and not is_denied(r), r.stdout)

    home6b = tmp / "home6b"
    (home6b / ".claude").mkdir(parents=True)
    (home6b / "bin").mkdir(parents=True)
    (home6b / "bin" / "file-issue").write_text("#!/bin/sh\n")
    a_record = record("aaa1111..bbb2222", ["c1 - MET: `f.py:1`"])
    env = stub_env(body="Part of #29.\n\nJust a note, no criteria heading.\n",
                    comments=[{"body": a_record, "createdAt": "t"}])
    r = run_hook(payload(CLOSE_CMD.format(n=13)), env_extra=env, home=home6b)
    check("no acceptance-criteria heading: denied", is_denied(r), r.stdout)
    check("no acceptance-criteria heading: reason code",
          logged(home6b, "deny", "missing-acceptance-criteria"), gate_rows(home6b))
    out6b = parse_stdout_json(r.stdout)
    reason6b = out6b["hookSpecificOutput"]["permissionDecisionReason"]
    check("no acceptance-criteria heading: names file-issue ticketify",
          "file-issue ticketify" in reason6b, reason6b)
    check("no acceptance-criteria heading: names close-ticket as the next step",
          "close-ticket" in reason6b, reason6b)
    check("no acceptance-criteria heading: names the No diff. remedy",
          "No diff." in reason6b, reason6b)

    home6b2 = tmp / "home6b2"
    (home6b2 / ".claude").mkdir(parents=True)
    (home6b2 / "bin").mkdir(parents=True)
    (home6b2 / "bin" / "file-issue").write_text("#!/bin/sh\n")
    b2_record = record("aaa1111..bbb2222", ["c1 - MET: `f.py:1`"])
    env = stub_env(body="Part of #29.\n\n## Acceptance criteria\n- not a checkbox item\n",
                    comments=[{"body": b2_record, "createdAt": "t"}])
    r6b2 = run_hook(payload(CLOSE_CMD.format(n=16)), env_extra=env, home=home6b2)
    check("zero-items heading: denied", is_denied(r6b2), r6b2.stdout)
    check("zero-items heading: reason code",
          logged(home6b2, "deny", "missing-acceptance-criteria"), gate_rows(home6b2))
    out6b2 = parse_stdout_json(r6b2.stdout)
    reason6b2 = out6b2["hookSpecificOutput"]["permissionDecisionReason"]
    check("zero-items heading: names file-issue ticketify",
          "file-issue ticketify" in reason6b2, reason6b2)
    check("zero-items heading: states plain bullets don't count",
          "don't count" in reason6b2, reason6b2)
    check("zero-items heading: names close-ticket as the next step",
          "close-ticket" in reason6b2, reason6b2)

    home6b3 = tmp / "home6b3"
    (home6b3 / ".claude").mkdir(parents=True)
    env = stub_env(body="Part of #29.\n\nJust a note, no criteria heading.\n",
                    comments=[{"body": a_record, "createdAt": "t"}])
    r6b3 = run_hook(payload(CLOSE_CMD.format(n=17)), env_extra=env, home=home6b3)
    check("no file-issue installed: still denied", is_denied(r6b3), r6b3.stdout)
    out6b3 = parse_stdout_json(r6b3.stdout)
    reason6b3 = out6b3["hookSpecificOutput"]["permissionDecisionReason"]
    check("no file-issue installed: names no path the reader cannot run",
          "~/bin" not in reason6b3, reason6b3)
    check("no file-issue installed: says what to write instead",
          "## Acceptance criteria` heading to the issue body" in reason6b3, reason6b3)
    check("no file-issue installed: still names close-ticket",
          "bin/close-ticket" in reason6b3, reason6b3)

    def nodiff_case(tag, body, comments):
        home = tmp / f"home7-{tag}"
        (home / ".claude").mkdir(parents=True)
        env = stub_env(body=body, comments=comments)
        result = run_hook(payload(CLOSE_CMD.format(n=5)), env_extra=env, home=home)
        return result, home

    r7a, _ = nodiff_case("no-heading", body_without_criteria(),
                         [{"body": nodiff_record(), "createdAt": "t"}])
    check("no-diff: allowed when the body declares no criteria",
          r7a.returncode == 0 and not is_denied(r7a), r7a.stdout)

    r7f, home7f = nodiff_case("empty-heading", issue_body(0),
                              [{"body": nodiff_record(), "createdAt": "t"}])
    check("no-diff: an empty `## Acceptance criteria` heading is still refused",
          is_denied(r7f), r7f.stdout)
    check("no-diff: empty heading reason is missing-acceptance-criteria",
          logged(home7f, "deny", "missing-acceptance-criteria"), gate_rows(home7f))

    r7g, home7g = nodiff_case("criteria-present", issue_body(2), [{"body": nodiff_record([
        "criterion 1 - MET: `f.py:1`",
        "criterion 2 - MET: `pytest -q` exit 0",
    ]), "createdAt": "t"}])
    check("no-diff: denied whenever the body carries criteria, even with well-formed bullets",
          is_denied(r7g), r7g.stdout)
    check("no-diff: reason is no-diff-with-criteria",
          logged(home7g, "deny", "no-diff-with-criteria"), gate_rows(home7g))

    r7h, _ = nodiff_case("criteria-present-no-bullets", issue_body(2),
                         [{"body": nodiff_record(), "createdAt": "t"}])
    check("no-diff: denied even with no bullets at all under it",
          is_denied(r7h), r7h.stdout)

    home8a = tmp / "home8a"
    (home8a / ".claude").mkdir(parents=True)
    api_state_cmd = "gh api repos/o/r/issues/6 -X PATCH -f state=closed"
    env = stub_env(body=issue_body(1), comments=[])
    r = run_hook(payload(api_state_cmd), env_extra=env, home=home8a)
    check("api state=closed: denied without record", is_denied(r), r.stdout)

    home8b = tmp / "home8b"
    (home8b / ".claude").mkdir(parents=True)
    graphql_cmd = (
        'gh api graphql -f query=\'mutation { closeIssue(input: {issueId: "I_x"}) '
        '{ issue { number } } }\' '
    ) + " # issues/7"
    env = stub_env(body=issue_body(1), comments=[])
    r = run_hook(payload(graphql_cmd), env_extra=env, home=home8b)
    check("api graphql closeIssue: denied without record", is_denied(r), r.stdout)

    home8c = tmp / "home8c"
    (home8c / ".claude").mkdir(parents=True)
    good1 = record("aaa1111..bbb2222", ["c1 - MET: `f.py:1`"])
    env = stub_env(body=issue_body(1), comments=[{"body": good1, "createdAt": "t"}])
    r = run_hook(payload(api_state_cmd), env_extra=env, home=home8c)
    check("api state=closed: allowed with valid record", r.returncode == 0 and not is_denied(r), r.stdout)

    home9 = tmp / "home9"
    (home9 / ".claude").mkdir(parents=True)
    r_cmd = 'gh issue close -R o/r 8 --comment "x"'
    env = stub_env(body=issue_body(1), comments=[])
    r = run_hook(payload(r_cmd), env_extra=env, home=home9)
    check("issue-close with -R prefix: still denies (number parsed, no record)", is_denied(r), r.stdout)

    for label, raw in _harness.MALFORMED_STDIN:
        homeN = tmp / f"home-malformed-{label}"
        (homeN / ".claude").mkdir(parents=True)
        r = run_hook(raw, home=homeN)
        check(f"malformed({label}): exit 0", r.returncode == 0, f"rc={r.returncode}")
        check(f"malformed({label}): silent stdout", r.stdout == b"", repr(r.stdout))
        if label == "empty-object":
            check(f"malformed({label}): valid JSON but cwd-less, so enrollment "
                  "cannot be told and it stands down with no row",
                  gate_rows(homeN) == [], gate_rows(homeN))
        else:
            check(f"malformed({label}): log row present, verdict=allow",
                  logged(homeN, "allow", "unparseable-stdin"), gate_rows(homeN))

    home11 = tmp / "home11"
    (home11 / ".claude").mkdir(parents=True)
    r = run_hook(payload('gh issue close --comment "x"'), home=home11)
    check("unparseable issue number: denied (fail-mode inversion)", is_denied(r), r.stdout)
    check("unparseable issue number: logged as deny",
          logged(home11, "deny", "unparseable-issue-number"), gate_rows(home11))

    home12 = tmp / "home12"
    (home12 / ".claude").mkdir(parents=True)
    r = run_hook(payload(CLOSE_CMD.format(n=9)), env_extra={"AGENT_SKILLS_GH": "/nonexistent/gh"}, home=home12)
    check("no gh resolvable: denied", is_denied(r), r.stdout)
    check("no gh resolvable: logged degraded",
          logged(home12, "degraded", "gh-not-found"), gate_rows(home12))

    home13 = tmp / "home13"
    (home13 / ".claude").mkdir(parents=True)
    r = run_hook(payload(CLOSE_CMD.format(n=10)), env_extra=stub_env(mode="fail"), home=home13)
    check("broken auth: denied", is_denied(r), r.stdout)
    check("broken auth: logged degraded",
          logged(home13, "degraded", "gh-error"), gate_rows(home13))

    home14 = tmp / "home14"
    (home14 / ".claude").mkdir(parents=True)
    start = time.monotonic()
    r = run_hook(payload(CLOSE_CMD.format(n=11)), env_extra=stub_env(mode="sleep", sleep=30), home=home14,
                 timeout=_harness.HOOK_TIMEOUT * 2)
    elapsed = time.monotonic() - start
    check("gh hangs: denied", is_denied(r), r.stdout)
    check("gh hangs: hook's own ~5s deadline, well under the 30s stub sleep", elapsed < 15, f"elapsed={elapsed:.1f}s")
    check("gh hangs: logged degraded/gh-timeout",
          logged(home14, "degraded", "gh-timeout"), gate_rows(home14))

    home15 = tmp / "home15"
    (home15 / ".claude").mkdir(parents=True)
    os.chmod(home15 / ".claude", 0o500)
    try:
        r = run_hook(payload(CLOSE_CMD.format(n=12)), env_extra={"AGENT_SKILLS_GH": "/nonexistent/gh"}, home=home15)
        check("unwritable log: verdict unchanged (still denies)", is_denied(r), r.stdout)
        check("unwritable log: exit 0 regardless", r.returncode == 0, f"rc={r.returncode}")
    finally:
        os.chmod(home15 / ".claude", 0o700)

    out = parse_stdout_json(r.stdout)
    check("systemMessage present and names the hook", "close-gate" in out.get("systemMessage", ""), out)

    for label, rng in [
        ("two shas", "abc1234..def5678"),
        ("ref..ref", "main..HEAD"),
        ("sha..ref", "0b8c4b5..HEAD"),
        ("tag..branch", "v1.0..main"),
        ("slashed ref", "origin/main..drain/spec-29-workflow-system"),
    ]:
        homeR = tmp / f"home-range-{label.replace(' ', '-').replace('..', '-')}"
        (homeR / ".claude").mkdir(parents=True)
        rec = record(rng, ["the criterion - MET: `hooks/close-gate.py:42`"])
        env = stub_env(body=issue_body(1), comments=[{"body": rec, "createdAt": "t"}])
        rr = run_hook(payload(CLOSE_CMD.format(n=30)), env_extra=env, home=homeR)
        check(f"range({label}) {rng!r}: allowed", rr.returncode == 0 and not is_denied(rr), rr.stdout)

    home17b = tmp / "home17b"
    (home17b / ".claude").mkdir(parents=True)
    buried = "## Closing record\n\n- the criterion main..HEAD - MET: `f.py:1`\n"
    env = stub_env(body=issue_body(1), comments=[{"body": buried, "createdAt": "t"}])
    r17b = run_hook(payload(CLOSE_CMD.format(n=31)), env_extra=env, home=home17b)
    check("range buried in a bullet is not a declared range: denied", is_denied(r17b), r17b.stdout)

    for label, cmd_text in [
        ("grep", 'grep -rn "gh issue close" hooks/'),
        ("rg single-quoted", "rg 'gh issue close' --files-with-matches"),
        ("echo", 'echo "the gate refuses a gh issue close without a record"'),
        ("commit message", 'git commit -m "document how gh issue close is gated"'),
    ]:
        homeP = tmp / f"home-prose-{label.replace(' ', '-')}"
        (homeP / ".claude").mkdir(parents=True)
        rp = run_hook(payload(cmd_text), home=homeP)
        check(f"prose mention ({label}): not treated as a close",
              rp.returncode == 0 and not is_denied(rp), rp.stdout)

    home18b = tmp / "home18b"
    (home18b / ".claude").mkdir(parents=True)
    env = stub_env(body=issue_body(1), comments=[])
    r18b = run_hook(payload("bash -c 'gh issue close 30'"), env_extra=env, home=home18b)
    check("quoted close naming an issue: still denied (quoting is not a bypass)",
          is_denied(r18b), r18b.stdout)

    home18c = tmp / "home18c"
    (home18c / ".claude").mkdir(parents=True)
    env = stub_env(body=issue_body(1), comments=[])
    r18c = run_hook(payload('grep -rn "gh issue close 30" hooks/'), env_extra=env, home=home18c)
    check("quoted mention that names an issue: gated, fail-closed", is_denied(r18c), r18c.stdout)

    good = record("aaaa..bbbb", ["criterion 1 - MET: `hooks/close-gate.py:1` proves it."])

    def aim_case(tag, command, cwd=None, mode="json"):
        home = tmp / f"home19-{tag}"
        (home / ".claude").mkdir(parents=True)
        argv_log = tmp / f"argv-{tag}.jsonl"
        env = stub_env(mode=mode, body=issue_body(1), comments=[])
        env["STUB_ARGV_LOG"] = str(argv_log)
        result = run_hook(payload(command, cwd=cwd), env_extra=env, home=home)
        calls = [json.loads(line) for line in
                 argv_log.read_text().splitlines()] if argv_log.exists() else []
        return result, calls, home

    r19a, calls19a, home19a = aim_case(
        "repo-flag", CLOSE_CMD_HEREDOC.format(n=7, record=good).replace(
            "gh issue close 7", "gh issue close 7 -R other/repo"))
    check("-R: gh is run against the named repo",
          bool(calls19a) and "-R" in calls19a[0]["argv"]
          and "other/repo" in calls19a[0]["argv"], calls19a)
    check("-R: a valid record still allows", not is_denied(r19a), r19a.stdout)
    check("-R: the log row names the repo verified against",
          any(row.get("repo") == "other/repo" for row in gate_rows(home19a)), gate_rows(home19a))

    r19b, calls19b, _ = aim_case(
        "repo-flag-before-number", CLOSE_CMD_HEREDOC.format(n=7, record=good).replace(
            "gh issue close 7", "gh issue close -R other/repo 7"))
    check("-R before the number: issue number still parses, repo still carried",
          bool(calls19b) and "7" in calls19b[0]["argv"]
          and "other/repo" in calls19b[0]["argv"], calls19b)
    check("-R before the number: a valid record still allows", not is_denied(r19b), r19b.stdout)

    r19c, calls19c, _ = aim_case(
        "long-repo-flag", CLOSE_CMD_HEREDOC.format(n=7, record=good).replace(
            "gh issue close 7", "gh issue close 7 --repo=other/repo"))
    check("--repo=owner/repo: carried through the same way",
          bool(calls19c) and "other/repo" in calls19c[0]["argv"], calls19c)

    elsewhere = tmp / "elsewhere"
    elsewhere.mkdir()
    r19d, calls19d, _ = aim_case(
        "compound-cd",
        f"cd {elsewhere} && " + CLOSE_CMD_HEREDOC.format(n=7, record=good))
    check("compound cd: gh runs from the directory the close cd'd into",
          bool(calls19d) and Path(calls19d[0]["cwd"]).resolve() == elsewhere.resolve(),
          calls19d)
    check("compound cd: a valid record still allows", not is_denied(r19d), r19d.stdout)

    r19e, calls19e, _ = aim_case(
        "cd-nonexistent",
        "cd /no/such/dir && " + CLOSE_CMD_HEREDOC.format(n=7, record=good))
    check("cd to a directory that does not exist: falls back to the payload cwd",
          bool(calls19e) and Path(calls19e[0]["cwd"]).resolve() == ENROLLED_CWD.resolve(),
          calls19e)

    r19f, calls19f, _ = aim_case(
        "both",
        f"cd {elsewhere} && " + CLOSE_CMD_HEREDOC.format(n=7, record=good).replace(
            "gh issue close 7", "gh issue close 7 -R other/repo"))
    check("cd and -R together: -R is the fetch target",
          bool(calls19f) and "other/repo" in calls19f[0]["argv"], calls19f)

    quoted_record = record("aaaa..bbbb", [
        "criterion 1 - MET: `cd /elsewhere && gh issue close 1 -R decoy/repo` exit 0."])
    r19g, calls19g, _ = aim_case(
        "quoted-payload", CLOSE_CMD_HEREDOC.format(n=7, record=quoted_record))
    check("quoted -R in the record: does not move the fetch target",
          bool(calls19g) and "decoy/repo" not in calls19g[0]["argv"], calls19g)
    check("quoted cd in the record: does not move the working directory",
          bool(calls19g) and Path(calls19g[0]["cwd"]).resolve() == ENROLLED_CWD.resolve(),
          calls19g)

    r19h, _, home19h = aim_case(
        "unreachable", CLOSE_CMD_HEREDOC.format(n=7, record=good).replace(
            "gh issue close 7", "gh issue close 7 -R other/repo"), mode="fail")
    check("-R at an unreachable repo: still denied as degraded",
          is_denied(r19h) and logged(home19h, "degraded"), gate_rows(home19h))

    malformed = [
        ("missing-range",
         1,
         "## Closing record\n\nRan the whole suite and it passed.\n\n- c1 - MET: `f.py:1`\n"),
        ("count-mismatch",
         2,
         record("aaa1111..bbb2222", ["c1 - MET: `f.py:1`"])),
    ]
    for i, (label, n_criteria, rec_text) in enumerate(malformed):
        home20 = tmp / f"home20-{label}"
        (home20 / ".claude").mkdir(parents=True)
        env = stub_env(body=issue_body(n_criteria), comments=[{"body": rec_text, "createdAt": "t"}])
        r20 = run_hook(payload(CLOSE_CMD.format(n=40 + i)), env_extra=env, home=home20)
        check(f"malformed({label}): denied", is_denied(r20), r20.stdout)
        reason20 = parse_stdout_json(r20.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
        check(f"malformed({label}): denial names close-ticket instead",
              "close-ticket" in reason20, reason20)

    def superseded_case(tag, n, n_criteria, rec_text, successor=None, state=None):
        home = tmp / f"home20b-{tag}"
        (home / ".claude").mkdir(parents=True)
        if successor is not None:
            env = successor_env(issue_body(n_criteria),
                                [{"body": rec_text, "createdAt": "t"}], successor, state)
        else:
            env = stub_env(body=issue_body(n_criteria),
                           comments=[{"body": rec_text, "createdAt": "t"}])
        return run_hook(payload(CLOSE_CMD.format(n=n)), env_extra=env, home=home)

    moved = ["criterion 1 - MOVED: #152 criterion 1",
             "criterion 2 - MOVED: #152 criterion 2",
             "criterion 3 - DROPPED: the suite it named no longer exists"]

    r_ok = superseded_case("accepted", 60, 3, superseded_record(152, moved))
    check("superseded: a full record naming a successor is allowed",
          not is_denied(r_ok) and r_ok.returncode == 0, r_ok.stdout)

    r_count = superseded_case("count", 61, 3, superseded_record(152, moved[:2]))
    check("superseded: fewer bullets than criteria is denied", is_denied(r_count), r_count.stdout)
    reason_count = parse_stdout_json(r_count.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
    check("superseded: the count denial is the existing arithmetic one",
          "3 acceptance criteria" in reason_count and "2" in reason_count, reason_count)

    r_prose = superseded_case(
        "prose-bullets", 62, 3, superseded_record(152, [
            "went somewhere, not sure where", "dropped for a reason I forget",
            "criterion 3 - MET: `hooks/close-gate.py:1`",
        ]))
    check("superseded: bullet content (MOVED/DROPPED/MET/prose) is never judged: allowed",
          not is_denied(r_prose) and r_prose.returncode == 0, r_prose.stdout)

    r_gone = superseded_case("successor-missing", 64, 3, superseded_record(999, moved))
    check("superseded: a successor number that resolves nowhere still allows (no lookup)",
          not is_denied(r_gone) and r_gone.returncode == 0, r_gone.stdout)

    r_closed = superseded_case("successor-closed", 65, 3, superseded_record(152, moved),
                               successor=152, state="CLOSED")
    check("superseded: a successor the tracker would report closed still allows (no lookup)",
          not is_denied(r_closed) and r_closed.returncode == 0, r_closed.stdout)

    def make_repo(path, ship_gate, gate_body="# a repo's own copy\n"):
        path.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(path)], check=True,
                       capture_output=True, text=True)
        subprocess.run(["git", "-C", str(path), "remote", "add", "origin",
                        "https://github.com/collod873/claude-workflow.git"],
                       check=True, capture_output=True, text=True)
        _harness.enroll(path)
        if ship_gate:
            hooks = path / ".claude" / "hooks"
            hooks.mkdir(parents=True)
            (hooks / "close-gate.py").write_text(gate_body)
        return path

    def standdown_case(tag, repo_path, command):
        home = tmp / f"home21-{tag}"
        (home / ".claude").mkdir(parents=True)
        argv_log = tmp / f"argv21-{tag}.jsonl"
        env = stub_env(body=issue_body(2), comments=[])
        env["STUB_ARGV_LOG"] = str(argv_log)
        result = run_hook(payload(command, cwd=str(repo_path)), env_extra=env, home=home)
        calls = [json.loads(line) for line in
                 argv_log.read_text().splitlines()] if argv_log.exists() else []
        return result, calls, home

    gated = make_repo(tmp / "repo-gated", ship_gate=True)
    r21a, calls21a, home21a = standdown_case("gated", gated, CLOSE_CMD.format(n=55))
    check("repo-gate: a close with no record is allowed through",
          not is_denied(r21a) and r21a.returncode == 0, r21a.stdout)
    check("repo-gate: no gh call is spent deciding to stand down",
          calls21a == [], calls21a)
    check("repo-gate: the stand-down leaves a countable row",
          logged(home21a, "allow", "repo-gate-owns-repo"), gate_rows(home21a))

    r21b, _, _ = standdown_case(
        "gated-but-aimed-elsewhere", gated,
        CLOSE_CMD.format(n=55).replace("gh issue close 55", "gh issue close 55 -R other/repo"))
    check("repo-gate: a -R close at another repo is still judged here",
          is_denied(r21b), r21b.stdout)

    ungated = make_repo(tmp / "repo-ungated", ship_gate=False)
    r21c, _, _ = standdown_case("ungated", ungated, CLOSE_CMD.format(n=55))
    check("repo-gate: a repo shipping no copy is still gated here",
          is_denied(r21c), r21c.stdout)

    self_gated = make_repo(tmp / "repo-self", ship_gate=False)
    self_hooks = self_gated / ".claude" / "hooks"
    self_hooks.mkdir(parents=True)
    (self_hooks / "close-gate.py").write_text(HOOK.read_text())
    (self_hooks / "_hook.py").symlink_to(HOOKS / "_hook.py")
    home21d = tmp / "home21-self"
    (home21d / ".claude").mkdir(parents=True)
    env21d = dict(os.environ)
    env21d.pop("AGENT_SKILLS_GH", None)
    env21d.update(stub_env(body=issue_body(2), comments=[]))
    env21d["HOME"] = str(home21d)
    r21d = _harness.run_hook(
        self_hooks / "close-gate.py",
        payload(CLOSE_CMD.format(n=55), cwd=str(self_gated)),
        env=env21d,
    ).proc
    check("repo-gate: the repo's own copy does not stand down for itself",
          is_denied(r21d), r21d.stdout)

    unenrolled = tmp / "repo-unenrolled"
    subprocess.run(["git", "init", "-q", str(unenrolled)], check=True, capture_output=True, text=True)
    home21u = tmp / "home21-unenrolled"
    (home21u / ".claude").mkdir(parents=True)
    argv_log21u = tmp / "argv21-unenrolled.jsonl"
    env21u = stub_env(body=issue_body(2), comments=[])
    env21u["STUB_ARGV_LOG"] = str(argv_log21u)
    r21u = run_hook(payload(CLOSE_CMD.format(n=55), cwd=str(unenrolled)),
                    env_extra=env21u, home=home21u)
    check("unenrolled: the same close-with-no-record command is silent",
          r21u.returncode == 0 and r21u.stdout == b"", r21u.stdout)
    check("unenrolled: no gh call is spent deciding to stand down",
          not argv_log21u.exists(), argv_log21u)
    check("unenrolled: no log row at all", gate_rows(home21u) == [], gate_rows(home21u))

    def reason_case(tag, command):
        home = tmp / f"home21b-{tag}"
        (home / ".claude").mkdir(parents=True)
        argv_log = tmp / f"argv21b-{tag}.jsonl"
        env = stub_env(body=issue_body(2), comments=[])
        env["STUB_ARGV_LOG"] = str(argv_log)
        result = run_hook(payload(command), env_extra=env, home=home)
        calls = [json.loads(line) for line in
                 argv_log.read_text().splitlines()] if argv_log.exists() else []
        return result, calls, home

    for tag, spelling in (("hyphen", "not-planned"), ("space", '"not planned"'),
                          ("underscore", "not_planned"), ("duplicate", "duplicate")):
        r, calls, home = reason_case(tag, f"gh issue close 55 --reason {spelling}")
        check(f"non-delivery({tag}): allowed with no record at all",
              not is_denied(r) and r.returncode == 0, r.stdout)
        check(f"non-delivery({tag}): the issue is never fetched", calls == [], calls)
        check(f"non-delivery({tag}): leaves a countable row",
              logged(home, "allow", "non-delivery-close"), gate_rows(home))

    r21e, calls21e, home21e = reason_case(
        "api", "gh api -X PATCH repos/o/r/issues/55 -f state=closed -f state_reason=not_planned")
    check("non-delivery(api): allowed with no record at all",
          not is_denied(r21e) and r21e.returncode == 0, r21e.stdout)
    check("non-delivery(api): leaves a countable row",
          logged(home21e, "allow", "non-delivery-close"), gate_rows(home21e))

    r21f, _, _ = reason_case("completed", "gh issue close 55 --reason completed")
    check("non-delivery: an explicit `completed` close is still judged",
          is_denied(r21f), r21f.stdout)

    r21g, _, _ = reason_case(
        "quoted", 'gh issue close 55 --comment "closing this, not a --reason not-planned case"')
    check("non-delivery: a reason quoted inside --comment does not count",
          is_denied(r21g), r21g.stdout)

    def stub_case(tag, checkout):
        home = tmp / f"home21c-{tag}"
        (home / ".claude").mkdir(parents=True)
        result = run_hook(payload(CLOSE_CMD.format(n=55), cwd=str(checkout)),
                          env_extra=stub_env(body=issue_body(2), comments=[]), home=home)
        return parse_stdout_json(result.stdout)["hookSpecificOutput"]["permissionDecisionReason"]

    other = make_repo(tmp / "repo-other", ship_gate=False)
    reason21h = stub_case("other", other)
    check("stub: the tool is resolved beside the hook's own file, not the target checkout",
          "bin/close-ticket 55 <base>..<head>" in reason21h
          and "~/.agents" not in reason21h, reason21h)

    close_gate.LOCAL_CLOSE_TICKET = tmp / "no-such-close-ticket"
    try:
        fallback_stub = close_gate.close_ticket_stub(55, str(other), None)
    finally:
        close_gate.LOCAL_CLOSE_TICKET = CLOSE_TICKET
    check("stub: falls back to ~/bin/close-ticket when the local file cannot be found",
          fallback_stub.startswith("~/bin/close-ticket 55 <base>..<head>"), fallback_stub)


def run_close_ticket_round_trip(tmp):
    checkout = tmp / "close-ticket-checkout"
    checkout.mkdir()
    argv_log = tmp / "close-ticket-argv.jsonl"
    body = (
        "## Acceptance criteria\n\n"
        "- [ ] first check passes - check: `true`\n"
        "- [ ] second check passes - check: `true`\n\n"
        "## Files claimed\n\n- None, no files.\n"
    )
    env = dict(os.environ)
    env["AGENT_SKILLS_GH"] = str(STUB_GH)
    env["STUB_JSON"] = json.dumps({"body": body})
    env["STUB_ARGV_LOG"] = str(argv_log)
    r = subprocess.run(
        [sys.executable, str(CLOSE_TICKET), "70", "aaa1111..bbb2222", str(checkout)],
        capture_output=True, text=True, env=env,
    )
    check("close-ticket round-trip: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")

    rows = [json.loads(ln) for ln in argv_log.read_text().splitlines()] if argv_log.exists() else []
    argvs = [row["argv"] for row in rows]
    check("close-ticket round-trip: the gh double's argv log shows the post and the close",
          any(a[:2] == ["issue", "comment"] for a in argvs)
          and any(a[:2] == ["issue", "close"] for a in argvs), argvs)

    generated_record = r.stdout
    marker = close_gate.find_marker_text(generated_record)
    check("close-ticket round-trip: the posted text starts with the closing-record heading",
          marker is not None, generated_record)

    criteria_count = close_gate.count_body_criteria(body)
    verdict, reason, message = close_gate.evaluate_record(marker, criteria_count)
    check("close-ticket round-trip: the gate allows the record close-ticket produced",
          verdict == "allow", (verdict, reason, message))


SETTINGS = Path.home() / ".claude" / "settings.json"


def run_timeout_budget():
    print("\n## The registered timeout must cover the worst-case subprocess budget")
    worst_case = (close_gate.GIT_REMOTE_TIMEOUT_SECONDS
                  + close_gate.GIT_REMOTE_TIMEOUT_SECONDS
                  + close_gate.GH_TIMEOUT_SECONDS)

    check("repo_toplevel is memoised, so both callers cost one git process",
          hasattr(close_gate.repo_toplevel, "cache_info"),
          "expected functools.lru_cache on repo_toplevel")

    close_gate.repo_toplevel.cache_clear()
    for _ in range(3):
        close_gate.repo_toplevel(str(REPO))
    misses = close_gate.repo_toplevel.cache_info().misses
    check("repo_toplevel: three asks for one cwd -> one git process", misses == 1,
          f"misses={misses}")

    try:
        registered = json.loads(SETTINGS.read_text())
    except (OSError, ValueError) as exc:
        check("settings.json unreadable: budget case skipped by name, not silently",
              True, f"{type(exc).__name__}: {exc}")
        return

    timeouts = [
        entry.get("timeout")
        for group in registered.get("hooks", {}).get("PreToolUse", [])
        for entry in group.get("hooks", [])
        if "close-gate.py" in str(entry.get("command", ""))
    ]
    if not timeouts:
        check("close-gate not registered on this machine: budget case skipped by name",
              True, "no PreToolUse entry naming close-gate.py")
        return

    for registered_timeout in timeouts:
        check(f"registered timeout ({registered_timeout}s) covers the "
              f"{worst_case}s worst-case budget",
              isinstance(registered_timeout, (int, float))
              and registered_timeout > worst_case,
              f"registered={registered_timeout} worst_case={worst_case}")


def main():
    tmp = Path(tempfile.mkdtemp(prefix="close-gate-test-"))
    try:
        run_cases(tmp)
        run_close_ticket_round_trip(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    run_timeout_budget()

    finish("All close-gate checks passed.")


if __name__ == "__main__":
    main()
