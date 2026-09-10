#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS = Path(__file__).resolve().parent
REPO = next((c for c in (HOOKS.parent, HOOKS.parent.parent) if (c / "bin").is_dir()), HOOKS.parent)
BIN = REPO / "bin"
FILE_ISSUE = BIN / "file-issue"
STUB_GH = HOOKS / "stub_gh.py"

_spec = importlib.util.spec_from_file_location("ticket_shape", BIN / "ticket_shape.py")
ticket_shape = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ticket_shape)

_gh_support_spec = importlib.util.spec_from_file_location("gh_support", BIN / "gh_support.py")
gh_support = importlib.util.module_from_spec(_gh_support_spec)
_gh_support_spec.loader.exec_module(gh_support)



QUESTION_BODY_OK = (
    "## Question\n\nShould we do the thing?\n\n"
    "Run `file-issue ticketify <n>` once this is decided.\n"
)

QUESTION_BODY_NO_EXIT_LINE = "## Question\n\nShould we do the thing?\n"

TICKET_BODY_MISSING_FILES = (
    "## Acceptance criteria\n\n- [ ] Criterion 1\n"
)

TICKET_BODY_OK = (
    "## Acceptance criteria\n\n- [ ] `hooks/test_file_issue.py` exists and exits 0\n\n"
    "## Files claimed\n\n- bin/file-issue\n"
)

TICKET_BODY_NO_EVIDENCE = (
    "## Acceptance criteria\n\n- [ ] It works well\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_BARE_WORD_COLON_NUMBER = (
    "## Acceptance criteria\n\n- [ ] see result at foo:12\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_CHECK_MARKER_OK = (
    "## Acceptance criteria\n\n"
    "- [ ] the close-gate suite passes - check: `python3 hooks/test_close_gate.py`\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_CHECK_MARKER_NO_COMMAND = (
    "## Acceptance criteria\n\n"
    "- [ ] the `close-gate` suite passes - check:\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_CHECK_MARKER_UNRELATED_BACKTICKS = (
    "## Acceptance criteria\n\n"
    "- [ ] the `hooks/test_close_gate.py` suite passes\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_CHECK_MARKER_MULTIPLE_SPANS = (
    "## Acceptance criteria\n\n"
    "- [ ] the close-gate suite passes - check: `python3 hooks/test_close_gate.py` `extra`\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_CLAIMS_CI = (
    "## Acceptance criteria\n\n- [ ] the lane runs green - check: `true`\n\n"
    "## Files claimed\n\n- .github/workflows/ci.yml\n"
)

TICKET_BODY_WORKSTATION_CLAIM = (
    "## Acceptance criteria\n\n- [ ] the workstation settings are correct - check: `true`\n\n"
    "## Files claimed\n\n- ~/.claude/settings.json\n"
)


def refusal(call) -> str | None:
    try:
        call()
    except ticket_shape.ValidationError as e:
        return str(e)
    return None



TICKET_BODY_CONFIG_ONLY_EVIDENCE = (
    "## Acceptance criteria\n\n- [ ] the value in `config/settings.yml` is 5\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_CONFIG_EVIDENCE_WITH_CHECK = (
    "## Acceptance criteria\n\n"
    "- [ ] the value in `config/settings.yml` is 5 - check: `jq .value config/settings.yml`\n\n"
    "## Files claimed\n\n- None, no files.\n"
)

TICKET_BODY_MIXED_EVIDENCE = (
    "## Acceptance criteria\n\n"
    "- [ ] `src/router.ts` reads `config/settings.yml` correctly\n\n"
    "## Files claimed\n\n- src/router.ts\n"
)

TICKET_BODY_CONFIG_CLAIMED_STILL_WARNS = (
    "## Acceptance criteria\n\n- [ ] `.claude/settings.json` carries no Stop entry\n\n"
    "## Files claimed\n\n- .claude/settings.json\n"
)


TICKET_BODY_MD_NAMES_A_SCRIPT = (
    "## Acceptance criteria\n\n"
    "- [ ] `docs/research/verification-boundaries-2026-08.md` names `stop-gate.py` as this "
    "repo's single turn-end owner.\n\n"
    "## Files claimed\n\n- None, no files.\n"
)


def test_config_or_md_evidence():
    print("config_or_md_evidence: a config/Markdown-only criterion warns unless checked")

    warnings = ticket_shape.config_or_md_evidence(TICKET_BODY_CONFIG_ONLY_EVIDENCE)
    check("config-only, no check: warns exactly once, naming a check: or a code fact",
          len(warnings) == 1 and "check:" in warnings[0] and "config" in warnings[0].lower(),
          warnings)

    check("config-only, with a check: marker: no warning",
          ticket_shape.config_or_md_evidence(TICKET_BODY_CONFIG_EVIDENCE_WITH_CHECK) == [])

    check("mixed evidence (a code path alongside the config path): no warning",
          ticket_shape.config_or_md_evidence(TICKET_BODY_MIXED_EVIDENCE) == [])

    claimed_warnings = ticket_shape.config_or_md_evidence(TICKET_BODY_CONFIG_CLAIMED_STILL_WARNS)
    check("claiming the config path does not exempt it: still warns exactly once",
          len(claimed_warnings) == 1, claimed_warnings)

    named_inside = ticket_shape.config_or_md_evidence(TICKET_BODY_MD_NAMES_A_SCRIPT)
    check("a bare filename the Markdown file mentions is not evidence of its own: still warns",
          len(named_inside) == 1, named_inside)

    check("validate('ticket', ...) surfaces the same warning",
          warnings == ticket_shape.validate("ticket", TICKET_BODY_CONFIG_ONLY_EVIDENCE,
                                             repo_root=REPO),
          warnings)


def test_validator():
    print("validator: per-kind accept / refuse / warn")

    check("note: empty body accepted", ticket_shape.validate("note", "") == [])

    try:
        ticket_shape.validate("question", "no heading here")
        check("question: refuses body without '## Question'", False, "did not raise")
    except ticket_shape.ValidationError as e:
        check("question: refuses body without '## Question'", "Question" in str(e), str(e))

    check("question: accepts body with '## Question'",
          ticket_shape.validate("question", QUESTION_BODY_OK) == [])

    try:
        ticket_shape.validate("ticket", TICKET_BODY_MISSING_FILES)
        check("ticket: refuses body missing '## Files claimed'", False, "did not raise")
    except ticket_shape.ValidationError as e:
        check("ticket: refuses body missing '## Files claimed'",
              "Files claimed" in str(e), str(e))

    try:
        ticket_shape.validate("ticket", "no headings at all")
        check("ticket: refuses body missing '## Acceptance criteria'", False, "did not raise")
    except ticket_shape.ValidationError as e:
        check("ticket: refuses body missing '## Acceptance criteria'",
              "Acceptance criteria" in str(e), str(e))

    check("ticket: accepts well-formed body with no warning",
          ticket_shape.validate("ticket", TICKET_BODY_OK, repo_root=REPO) == [])

    warnings = ticket_shape.validate("ticket", TICKET_BODY_NO_EVIDENCE)
    check("ticket: warns (not refuses) when no criterion carries evidence",
          len(warnings) == 1, warnings)

    bare_word_warnings = ticket_shape.validate("ticket", TICKET_BODY_BARE_WORD_COLON_NUMBER)
    check("ticket: warns when the only 'evidence' is a bare-word `path:line` (no / or .)",
          len(bare_word_warnings) == 1, bare_word_warnings)

    for label, body in (
        ("empty body", ""),
        ("no '## Acceptance criteria' heading", "## Problem Statement\n\nIt's broken.\n"),
    ):
        msg = refusal(lambda b=body: ticket_shape.validate("spec", b))
        check(f"spec: refuses a body with {label}, naming the heading it needs",
              msg is not None and "Acceptance criteria" in msg, msg)

    empty_heading = "## Acceptance criteria\n\nSome prose, no items.\n"
    msg = refusal(lambda: ticket_shape.validate("spec", empty_heading))
    check("spec: refuses a heading carrying no '- [ ]' item",
          msg is not None and "exactly one" in msg, msg)

    two = ("## Acceptance criteria\n\n"
           "- [ ] first - check: `true`\n- [ ] second - check: `true`\n")
    msg = refusal(lambda: ticket_shape.validate("spec", two))
    check("spec: refuses two criteria: exactly one, not at least one",
          msg is not None and "not 2" in msg, msg)

    unrunnable = "## Acceptance criteria\n\n- [ ] I'll know it works when the lights come on\n"
    msg = refusal(lambda: ticket_shape.validate("spec", unrunnable))
    check("spec: refuses the one criterion when it carries no check marker",
          msg is not None and "check:" in msg, msg)

    malformed = "## Acceptance criteria\n\n- [ ] it works - check: no backticks here\n"
    msg = refusal(lambda: ticket_shape.validate("spec", malformed))
    check("spec: refuses a check marker that doesn't parse, rather than warning",
          msg is not None and "check:" in msg, msg)

    remote = ("## Acceptance criteria\n\n"
              "- [ ] the release lane has run once in production - check: "
              "`gh run list --workflow release.yml --json conclusion`\n")
    check("spec: a check that reads the tracker is accepted, not refused",
          ticket_shape.validate("spec", remote) == [])

    good = ("## Problem Statement\n\nIt's broken.\n\n"
            "## Acceptance criteria\n\n"
            "- [ ] I can see a green deploy on the dashboard - check: `false`\n")
    check("spec: accepts exactly one criterion carrying a well-formed marker",
          ticket_shape.validate("spec", good) == [])


def test_check_marker():
    print("check marker: parse_check_marker and validate()'s malformed-marker warning")

    delims = ["—", "–", " - ", " -- "]
    for d in delims:
        crit = f"- [ ] the close-gate suite passes{d}check: `python3 hooks/test_close_gate.py`"
        check(f"parse: {d!r} delimiter parses to the command",
              ticket_shape.parse_check_marker(crit) == "python3 hooks/test_close_gate.py", crit)

    check("validate: well-formed marker warns about nothing",
          ticket_shape.validate("ticket", TICKET_BODY_CHECK_MARKER_OK, repo_root=REPO) == [],
          ticket_shape.validate("ticket", TICKET_BODY_CHECK_MARKER_OK, repo_root=REPO))

    no_command_warnings = ticket_shape.validate(
        "ticket", TICKET_BODY_CHECK_MARKER_NO_COMMAND, repo_root=REPO)
    check("parse: label with no command returns None",
          ticket_shape.parse_check_marker("- [ ] passes - check:") is None, None)
    check("validate: label with no command warns exactly once, named malformed-marker",
          len(no_command_warnings) == 1
          and ticket_shape.MALFORMED_CHECK_MARKER_PREFIX in no_command_warnings[0],
          no_command_warnings)

    unrelated_warnings = ticket_shape.validate(
        "ticket", TICKET_BODY_CHECK_MARKER_UNRELATED_BACKTICKS, repo_root=REPO)
    check("parse: unrelated backticks with no `check:` label returns None",
          ticket_shape.parse_check_marker("- [ ] the `foo.py` thing passes") is None, None)
    check("validate: unrelated backticks (no `check:` label) warn about nothing",
          unrelated_warnings == [], unrelated_warnings)

    multi_span_warnings = ticket_shape.validate(
        "ticket", TICKET_BODY_CHECK_MARKER_MULTIPLE_SPANS, repo_root=REPO)
    check("parse: more than one backticked span after `check:` returns None",
          ticket_shape.parse_check_marker("- [ ] passes - check: `a` `b`") is None, None)
    check("validate: multiple backticked spans warn exactly once, named malformed-marker",
          len(multi_span_warnings) == 1
          and ticket_shape.MALFORMED_CHECK_MARKER_PREFIX in multi_span_warnings[0],
          multi_span_warnings)


RECORDING_GH = (
    "#!/usr/bin/env python3\n"
    "import json, os, sys\n"
    "with open(os.environ['RECORD_LOG'], 'a') as f:\n"
    "    f.write(json.dumps({'argv': sys.argv[1:], 'GH_REPO': os.environ.get('GH_REPO')}) + '\\n')\n"
)


def test_bind_gh_repo_binding(tmp):
    print("gh_support.bind_gh: GH_REPO in the environment names the repo on every call (#418)")

    recorder = tmp / "recording-gh.py"
    recorder.write_text(RECORDING_GH)
    recorder.chmod(0o755)
    log = tmp / "bind-gh-calls.jsonl"
    env = {**os.environ, "RECORD_LOG": str(log)}

    gh = gh_support.bind_gh(str(recorder), "acme/widgets")

    def call(*args):
        result = gh(*args, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return result

    call("api", "repos/{owner}/{repo}/issues", "--method", "GET")
    call("issue", "view", "1")

    rows = [json.loads(ln) for ln in log.read_text().splitlines() if ln.strip()]
    api_row = next(r for r in rows if r["argv"][0] == "api")
    issue_row = next(r for r in rows if r["argv"][0] == "issue")

    check("gh api: argv carries no -R (#418, gh api rejects the flag)",
          "-R" not in api_row["argv"], api_row)
    check("gh api: GH_REPO reaches the call through the environment",
          api_row["GH_REPO"] == "acme/widgets", api_row)
    check("gh issue: argv carries no -R either, one rule for every subcommand",
          "-R" not in issue_row["argv"], issue_row)
    check("gh issue: GH_REPO reaches the call through the environment",
          issue_row["GH_REPO"] == "acme/widgets", issue_row)



ROWLOG = _harness.RowLog("file-issue-log-")


def run_cli(args, env_extra=None, body_file=None, cwd=None):
    env = ROWLOG.env()
    env["AGENT_SKILLS_GH"] = str(STUB_GH)
    if env_extra:
        env.update(env_extra)
    argv = [sys.executable, str(FILE_ISSUE), *args]
    if body_file is not None:
        argv += ["--body-file", str(body_file)]
    return subprocess.run(argv, capture_output=True, text=True, env=env, cwd=cwd)


def issue_obj(number, id_, body, labels=None, assignees=None):
    return {
        "number": number,
        "id": id_,
        "body": body,
        "labels": [{"name": n} for n in (labels or [])],
        "assignees": [{"login": a} for a in (assignees or [])],
    }


def write_body(tmp, name, text):
    p = tmp / name
    p.write_text(text)
    return p


def read_log_rows(log_path):
    if not log_path.exists():
        return []
    lines = [ln for ln in log_path.read_text().splitlines() if ln.strip()]
    return [json.loads(ln) for ln in lines]


def read_argv_log(log_path):
    return [row["argv"] for row in read_log_rows(log_path)]


def test_cli(tmp):
    print("helper CLI: bin/file-issue against hooks/stub_gh.py")

    log = tmp / "log1.jsonl"
    body = write_body(tmp, "ticket-missing-files.md", TICKET_BODY_MISSING_FILES)
    r = run_cli(["ticket", "--title", "A ticket"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("ticket/missing-files: exits nonzero", r.returncode != 0, r.returncode)
    check("ticket/missing-files: names the missing heading on stderr",
          "Files claimed" in r.stderr, r.stderr)
    check("ticket/missing-files: never called gh", read_argv_log(log) == [],
          read_argv_log(log))

    log = tmp / "log2.jsonl"
    body = write_body(tmp, "ticket-ok.md", TICKET_BODY_OK)
    r = run_cli(["ticket", "--title", "A ticket"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("ticket/ok: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    calls = read_argv_log(log)
    check("ticket/ok: two gh calls: label create, then issue create", len(calls) == 2, calls)
    if len(calls) == 2:
        check("ticket/ok: the ticket label is ensured before the issue is created",
              calls[0][:3] == ["label", "create", "ticket"] and "--force" in calls[0], calls[0])
        check("ticket/ok: issue create carries --label ticket",
              calls[1][:2] == ["issue", "create"] and "--label" in calls[1]
              and calls[1][calls[1].index("--label") + 1] == "ticket", calls[1])

    log = tmp / "log2b.jsonl"
    body = write_body(tmp, "ticket-no-evidence.md", TICKET_BODY_NO_EVIDENCE)
    r = run_cli(["ticket", "--title", "A ticket"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("ticket/no-evidence: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("ticket/no-evidence: warning on stderr", "warning:" in r.stderr, r.stderr)

    log = tmp / "log2c.jsonl"
    body = write_body(tmp, "ticket-malformed-check-marker.md", TICKET_BODY_CHECK_MARKER_NO_COMMAND)
    r = run_cli(["ticket", "--title", "A ticket"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("ticket/malformed-check-marker: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    check("ticket/malformed-check-marker: named warning on stderr",
          "warning:" in r.stderr and "check:" in r.stderr and "doesn't parse" in r.stderr,
          r.stderr)
    check("ticket/malformed-check-marker: still filed (label create, then issue create)",
          [c[:2] for c in read_argv_log(log)] == [["label", "create"], ["issue", "create"]],
          read_argv_log(log))

    log = tmp / "log2d.jsonl"
    body = write_body(tmp, "ticket-check-marker-ok.md", TICKET_BODY_CHECK_MARKER_OK)
    r = run_cli(["ticket", "--title", "A ticket"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("ticket/check-marker-ok: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    check("ticket/check-marker-ok: no warning on stderr", "warning:" not in r.stderr, r.stderr)

    log = tmp / "log3.jsonl"
    body = write_body(tmp, "question-missing.md", "just some prose\n")
    r = run_cli(["question", "--title", "A question"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("question/missing: exits nonzero", r.returncode != 0, r.returncode)
    check("question/missing: names '## Question'", "Question" in r.stderr, r.stderr)
    check("question/missing: never called gh", read_argv_log(log) == [], read_argv_log(log))

    log = tmp / "log4.jsonl"
    body = write_body(tmp, "question-ok.md", QUESTION_BODY_OK)
    r = run_cli(["question", "--title", "A question"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("question/ok: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    calls = read_argv_log(log)
    check("question/ok: exactly one gh call", len(calls) == 1, calls)
    if calls:
        argv0 = calls[0]
        check("question/ok: --label fuzzy", "--label" in argv0 and
              argv0[argv0.index("--label") + 1] == "fuzzy", argv0)
        body_idx = argv0.index("--body") + 1 if "--body" in argv0 else None
        emitted_body = argv0[body_idx] if body_idx is not None else ""
        check("question/ok: body carries a line naming file-issue ticketify",
              "file-issue ticketify" in emitted_body, emitted_body)

    log = tmp / "log4b.jsonl"
    body = write_body(tmp, "question-no-exit-line.md", QUESTION_BODY_NO_EXIT_LINE)
    r = run_cli(["question", "--title", "A question"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("question/no-exit-line: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    calls = read_argv_log(log)
    if calls:
        argv0 = calls[0]
        body_idx = argv0.index("--body") + 1 if "--body" in argv0 else None
        emitted_body = argv0[body_idx] if body_idx is not None else ""
        check("question/no-exit-line: source body had no ticketify mention",
              "file-issue ticketify" not in QUESTION_BODY_NO_EXIT_LINE,
              QUESTION_BODY_NO_EXIT_LINE)
        check("question/no-exit-line: file-issue appends the exit line itself",
              "file-issue ticketify" in emitted_body, emitted_body)
        check("question/no-exit-line: appended exactly once",
              emitted_body.count("file-issue ticketify") == 1, emitted_body)

    log = tmp / "log4c.jsonl"
    body = write_body(tmp, "question-dupe.md", QUESTION_BODY_OK)
    r = run_cli(["question", "--title", "A question"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("question/dupe: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    calls = read_argv_log(log)
    if calls:
        argv0 = calls[0]
        body_idx = argv0.index("--body") + 1 if "--body" in argv0 else None
        emitted_body = argv0[body_idx] if body_idx is not None else ""
        check("question/dupe: exit line not duplicated when already present",
              emitted_body.count("file-issue ticketify") == 1, emitted_body)

    log = tmp / "log5.jsonl"
    r = run_cli(["note", "--title", "A note"], env_extra={"STUB_ARGV_LOG": str(log)})
    check("note: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    calls = read_argv_log(log)
    check("note: exactly one gh call", len(calls) == 1, calls)
    if calls:
        check("note: issue create, no --label",
              calls[0][:2] == ["issue", "create"] and "--label" not in calls[0], calls[0])
        body_idx = calls[0].index("--body") + 1 if "--body" in calls[0] else None
        check("note: empty body", body_idx is not None and calls[0][body_idx] == "",
              calls[0])

    spec_body = tmp / "spec-body.md"
    spec_body.write_text(
        "## Problem Statement\n\nWidgets don't work.\n\n"
        "## Acceptance criteria\n\n"
        "- [ ] I can order a widget and it arrives - check: `false`\n"
    )

    log = tmp / "log6.jsonl"
    r = run_cli(["spec", "--title", "Widgets"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=spec_body)
    check("spec: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    calls = read_argv_log(log)
    check("spec: two gh calls (label ensure, then issue create)", len(calls) == 2, calls)
    if len(calls) == 2:
        check("spec: first call ensures the 'prd' label exists",
              calls[0][:2] == ["label", "create"] and calls[0][2] == "prd" and
              "--force" in calls[0], calls[0])
        title_idx = calls[1].index("--title") + 1 if "--title" in calls[1] else None
        check("spec: second call creates the issue titled 'PRD: Widgets'",
              title_idx is not None and calls[1][title_idx] == "PRD: Widgets", calls[1])
        check("spec: --label prd", "--label" in calls[1] and
              calls[1][calls[1].index("--label") + 1] == "prd", calls[1])

    log = tmp / "log6b.jsonl"
    r = run_cli(["spec", "--title", "PRD: Widgets"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=spec_body)
    check("spec/already-prefixed: exits 0", r.returncode == 0, r.stderr)
    calls = read_argv_log(log)
    if len(calls) == 2:
        title_idx = calls[1].index("--title") + 1 if "--title" in calls[1] else None
        check("spec/already-prefixed: title not double-prefixed",
              title_idx is not None and calls[1][title_idx] == "PRD: Widgets", calls[1])

    log = tmp / "log7.jsonl"
    r = run_cli(["note", "--title", "cross-repo", "-R", "acme/widgets"],
                env_extra={"STUB_ARGV_LOG": str(log)})
    check("note/-R: exits 0", r.returncode == 0, r.stderr)
    rows = read_log_rows(log)
    if rows:
        check("note/-R: no -R in argv, GH_REPO carried in the environment instead (#418)",
              "-R" not in rows[0]["argv"] and rows[0]["GH_REPO"] == "acme/widgets", rows[0])

    log = tmp / "log8.jsonl"
    r = run_cli(["spec", "--title", "cross-repo spec", "-R", "acme/widgets"],
                env_extra={"STUB_ARGV_LOG": str(log)}, body_file=spec_body)
    check("spec/-R: exits 0", r.returncode == 0, r.stderr)
    rows = read_log_rows(log)
    check("spec/-R: no -R in argv, GH_REPO carried on every gh call instead (#418)",
          len(rows) == 2 and all("-R" not in row["argv"] and row["GH_REPO"] == "acme/widgets"
                                  for row in rows),
          rows)



NEW_CRITERIA_BODY = (
    "## Acceptance criteria\n\n- [ ] `hooks/test_file_issue.py` covers ticketify\n\n"
    "## Files claimed\n\n- bin/file-issue\n"
)


def run_ticketify(n, extra_args, issues, body_text, log):
    env = {"STUB_ARGV_LOG": str(log), "STUB_JSON": json.dumps(issues)}
    body = None
    if body_text is not None:
        body = log.with_suffix(".body.md")
        body.write_text(body_text)
    r = run_cli(["ticketify", str(n), *extra_args], env_extra=env, body_file=body)
    return r, read_argv_log(log)


def body_file_content(argv):
    idx = argv.index("--body-file") + 1 if "--body-file" in argv else None
    return Path(argv[idx]).read_text() if idx is not None else None


def test_ticketify(tmp):
    print("ticketify: the one exit from fuzzy")

    log = tmp / "tk1.jsonl"
    issues = [issue_obj(10, 1010, "Some fuzzy description.\n", labels=["fuzzy"])]
    r, calls = run_ticketify(10, [], issues, NEW_CRITERIA_BODY, log)
    check("no-criteria: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("no-criteria: fetch, ensure the ticket label, then edit: three gh calls",
          len(calls) == 3, calls)
    if len(calls) == 3:
        check("no-criteria: first call lists open issues",
              calls[0][:2] == ["api", "repos/{owner}/{repo}/issues"], calls[0])
        check("no-criteria: the ticket label is ensured before the edit that applies it",
              calls[1][:3] == ["label", "create", "ticket"], calls[1])
        check("no-criteria: third call is issue edit on #10",
              calls[2][:3] == ["issue", "edit", "10"], calls[2])
        check("no-criteria: --remove-label fuzzy",
              "--remove-label" in calls[2] and
              calls[2][calls[2].index("--remove-label") + 1] == "fuzzy", calls[2])
        check("no-criteria: --add-label ticket",
              "--add-label" in calls[2] and
              calls[2][calls[2].index("--add-label") + 1] == "ticket", calls[2])
        new_body = body_file_content(calls[2]) or ""
        check("no-criteria: new body ends with both canonical headings",
              new_body.rstrip().endswith("## Files claimed\n\n- bin/file-issue")
              and "## Acceptance criteria" in new_body, new_body)
        check("no-criteria: new body keeps the original text",
              "Some fuzzy description." in new_body, new_body)

    log = tmp / "tk2.jsonl"
    existing = "## Acceptance criteria\n\n- [ ] old\n\n## Files claimed\n\n- old/path\n"
    issues = [issue_obj(11, 1111, existing)]
    r, calls = run_ticketify(11, [], issues, NEW_CRITERIA_BODY, log)
    check("has-criteria/no-replace: exits nonzero", r.returncode != 0, r.returncode)
    check("has-criteria/no-replace: names --replace on stderr", "--replace" in r.stderr, r.stderr)
    check("has-criteria/no-replace: never edits the issue",
          all(c[:2] != ["issue", "edit"] for c in calls), calls)

    log = tmp / "tk3.jsonl"
    issues = [issue_obj(12, 1212, existing)]
    r, calls = run_ticketify(12, ["--replace"], issues, NEW_CRITERIA_BODY, log)
    check("replace: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    edit_calls = [c for c in calls if c[:2] == ["issue", "edit"]]
    check("replace: exactly one edit call", len(edit_calls) == 1, calls)
    if edit_calls:
        new_body = body_file_content(edit_calls[0]) or ""
        check("replace: exactly one copy of each heading",
              new_body.count("## Acceptance criteria") == 1
              and new_body.count("## Files claimed") == 1, new_body)
        check("replace: old claim is gone", "old/path" not in new_body, new_body)
        check("replace: new claim is present", "bin/file-issue" in new_body, new_body)

    log = tmp / "tk4.jsonl"
    issues = [issue_obj(13, 1313, existing, assignees=["collin"])]
    r, calls = run_ticketify(13, ["--replace"], issues, NEW_CRITERIA_BODY, log)
    check("replace/assignee: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    comment_calls = [c for c in calls if c[:2] == ["issue", "comment"]]
    check("replace/assignee: exactly one comment call", len(comment_calls) == 1, calls)
    if comment_calls:
        body_idx = comment_calls[0].index("--body") + 1
        check("replace/assignee: comment names criteria revised after work started",
              "revised after work started" in comment_calls[0][body_idx],
              comment_calls[0][body_idx])

    log = tmp / "tk4b.jsonl"
    issues = [issue_obj(14, 1414, existing)]
    r, calls = run_ticketify(14, ["--replace"], issues, NEW_CRITERIA_BODY, log)
    check("replace/no-assignee: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("replace/no-assignee: no comment call",
          all(c[:2] != ["issue", "comment"] for c in calls), calls)

    log = tmp / "tk5.jsonl"
    claim_body = "## Files claimed\n\n- bin/file-issue\n"
    issues = [
        issue_obj(20, 2020, "no criteria yet\n"),
        issue_obj(15, 1515, claim_body),
        issue_obj(25, 2525, claim_body),
        issue_obj(30, 3030, "## Files claimed\n\n- unrelated/path\n"),
    ]
    supplied = (
        "## Acceptance criteria\n\n- [ ] evidence at `bin/file-issue`\n\n"
        "## Files claimed\n\n- bin/file-issue\n"
    )
    r, calls = run_ticketify(20, [], issues, supplied, log)
    check("intersection: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    post_calls = [c for c in calls if c[:3] == ["api", "-X", "POST"]]
    check("intersection: exactly two blocked_by POSTs", len(post_calls) == 2, calls)

    def post_target(c):
        return c[3].split("/issues/")[1].split("/dependencies")[0]

    def post_issue_id(c):
        return c[c.index("-F") + 1].split("=", 1)[1]

    if len(post_calls) == 2:
        by_blocked = {post_target(c): post_issue_id(c) for c in post_calls}
        check("intersection: #20 blocked by lower #15 (POST on #20, issue_id=#15's db id)",
              by_blocked.get("20") == "1515", post_calls)
        check("intersection: #25 blocked by lower #20 (POST on #25, issue_id=#20's db id)",
              by_blocked.get("25") == "2020", post_calls)
        check("intersection: unrelated #30 never appears", "30" not in by_blocked, post_calls)

    log = tmp / "tk6.jsonl"
    degenerate = "## Acceptance criteria\n\n- [ ] x\n\n## Files claimed\n\n- **\n"
    r, calls = run_ticketify(16, [], [], degenerate, log)
    check("degenerate: exits nonzero", r.returncode != 0, r.returncode)
    check("degenerate: names the canonical degenerate-claim message",
          "could not name the files this touches" in r.stderr, r.stderr)
    check("degenerate: never called gh", calls == [], calls)

    log = tmp / "tk7.jsonl"
    issues = [issue_obj(17, 1717, "Some fuzzy description.\n", labels=["fuzzy"])]
    r, calls = run_ticketify(17, ["-R", "acme/widgets"], issues, NEW_CRITERIA_BODY, log)
    check("-R: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    rows = read_log_rows(log)
    api_rows = [row for row in rows if row["argv"][:1] == ["api"]]
    other_rows = [row for row in rows if row["argv"][:1] != ["api"]]
    check("-R: at least one api call and one non-api call exercised",
          bool(api_rows) and bool(other_rows), rows)
    check("-R: no gh api call carries -R (#418, gh api rejects the flag)",
          all("-R" not in row["argv"] for row in api_rows), api_rows)
    check("-R: no other gh call carries -R either, GH_REPO carries the repo for all of them",
          bool(rows) and all("-R" not in row["argv"] and row["GH_REPO"] == "acme/widgets"
                              for row in rows),
          rows)



def labels_of(call):
    labels = set()
    for i, token in enumerate(call):
        if token in ("--label", "--add-label"):
            labels.update(n.strip() for n in call[i + 1].split(",") if n.strip())
    return labels


def all_labels(calls):
    out = set()
    for c in calls:
        out |= labels_of(c)
    return out


def test_by_hand_label(tmp):
    print("#438: by-hand alongside ticket for a workstation or cross-repo claim, "
          "no such label for an ordinary one")

    log = tmp / "bh1.jsonl"
    body = write_body(tmp, "ticket-workstation.md", TICKET_BODY_WORKSTATION_CLAIM)
    r = run_cli(["ticket", "--title", "A ticket"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("ticket/workstation claim: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    labels = all_labels(read_argv_log(log))
    check("ticket/workstation claim: labelled ticket and by-hand",
          {"ticket", "by-hand"} <= labels, labels)

    log = tmp / "bh2.jsonl"
    body = write_body(tmp, "ticket-cross-repo.md", TICKET_BODY_OK)
    r = run_cli(["ticket", "--title", "A ticket", "-R", "acme/widgets"],
                env_extra={"STUB_ARGV_LOG": str(log)}, body_file=body)
    check("ticket/-R cross-repo: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    labels = all_labels(read_argv_log(log))
    check("ticket/-R cross-repo: labelled ticket and by-hand",
          {"ticket", "by-hand"} <= labels, labels)

    log = tmp / "bh3.jsonl"
    body = write_body(tmp, "ticket-ordinary.md", TICKET_BODY_OK)
    r = run_cli(["ticket", "--title", "A ticket"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("ticket/ordinary claim: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    labels = all_labels(read_argv_log(log))
    check("ticket/ordinary claim: labelled ticket, not by-hand",
          "ticket" in labels and "by-hand" not in labels, labels)

    log = tmp / "bh4.jsonl"
    issues = [issue_obj(60, 6060, "Some fuzzy description.\n", labels=["fuzzy"])]
    workstation_supplied = (
        "## Acceptance criteria\n\n- [ ] the workstation is wired - check: `true`\n\n"
        "## Files claimed\n\n- ~/.claude/settings.json\n"
    )
    r, calls = run_ticketify(60, [], issues, workstation_supplied, log)
    check("ticketify/workstation claim: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    labels = all_labels(calls)
    check("ticketify/workstation claim: labelled ticket and by-hand",
          {"ticket", "by-hand"} <= labels, labels)

    log = tmp / "bh5.jsonl"
    issues = [issue_obj(61, 6161, "Some fuzzy description.\n", labels=["fuzzy"])]
    r, calls = run_ticketify(61, ["-R", "acme/widgets"], issues, NEW_CRITERIA_BODY, log)
    check("ticketify/-R cross-repo: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    labels = all_labels(calls)
    check("ticketify/-R cross-repo: labelled ticket and by-hand",
          {"ticket", "by-hand"} <= labels, labels)

    log = tmp / "bh6.jsonl"
    issues = [issue_obj(62, 6262, "Some fuzzy description.\n", labels=["fuzzy"])]
    r, calls = run_ticketify(62, [], issues, NEW_CRITERIA_BODY, log)
    check("ticketify/ordinary claim: exits 0", r.returncode == 0,
          f"rc={r.returncode} stderr={r.stderr}")
    labels = all_labels(calls)
    check("ticketify/ordinary claim: labelled ticket, not by-hand",
          "ticket" in labels and "by-hand" not in labels, labels)


TEST_FILE_TWO_TITLES = (
    'test.fails("#?.1: does the first thing", () => {})\n'
    "it.fails('#?.2: does the second thing', () => {})\n"
)

TICKET_BODY_TWO_CRITERIA = (
    "## Acceptance criteria\n\n"
    "- [ ] the first thing works - check: `true`\n"
    "- [ ] the second thing works - check: `true`\n\n"
    "## Files claimed\n\n- tests/acceptance.test.ts\n"
)


def _git(args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def make_git_repo(base: Path):
    base.mkdir(parents=True, exist_ok=True)
    remote = base / "remote.git"
    repo = base / "repo"
    _git(["init", "--bare", "-q", str(remote)], cwd=base)
    _git(["init", "-q", str(repo)], cwd=base)
    for args in (
        ["config", "user.email", "test@example.com"],
        ["config", "user.name", "Test"],
        ["remote", "add", "origin", str(remote)],
    ):
        _git(args, cwd=repo)
    (repo / "README.md").write_text("hello\n")
    _git(["add", "README.md"], cwd=repo)
    _git(["commit", "-q", "-m", "init"], cwd=repo)
    _git(["push", "-q", "-u", "origin", "HEAD:main"], cwd=repo)
    _git(["checkout", "-q", "-b", "work"], cwd=repo)
    return repo, remote


def test_test_handoff(tmp):
    print("--test: refuse before creating anything; hand off on success; fail loud on git")

    log = tmp / "th-missing.jsonl"
    body = write_body(tmp, "th-body.md", TICKET_BODY_TWO_CRITERIA)
    r = run_cli(["ticket", "--title", "T", "--test", str(tmp / "does-not-exist.test.ts")],
                env_extra={"STUB_ARGV_LOG": str(log)}, body_file=body)
    check("missing --test path: exits nonzero", r.returncode != 0, r.returncode)
    check("missing --test path: names the missing path", "not found" in r.stderr, r.stderr)
    check("missing --test path: never called gh", read_argv_log(log) == [], read_argv_log(log))

    log = tmp / "th-missing-index.jsonl"
    one_title = write_body(tmp, "th-one-title.test.ts", 'test.fails("#?.1: only one", () => {})\n')
    r = run_cli(["ticket", "--title", "T", "--test", str(one_title)],
                env_extra={"STUB_ARGV_LOG": str(log)}, body_file=body)
    check("missing index: exits nonzero", r.returncode != 0, r.returncode)
    check("missing index: names index 2", "[2]" in r.stderr, r.stderr)
    check("missing index: never called gh", read_argv_log(log) == [], read_argv_log(log))

    log = tmp / "th-stray.jsonl"
    stray = write_body(tmp, "th-stray.test.ts",
                        'test.fails("#?.1: only one", () => {})\n'
                        'it.fails("#?.2: two", () => {})\n'
                        "// see also #? elsewhere\n")
    r = run_cli(["ticket", "--title", "T", "--test", str(stray)],
                env_extra={"STUB_ARGV_LOG": str(log)}, body_file=body)
    check("stray '#?': exits nonzero", r.returncode != 0, r.returncode)
    check("stray '#?': names it", "outside a well-formed" in r.stderr, r.stderr)
    check("stray '#?': never called gh", read_argv_log(log) == [], read_argv_log(log))

    real_ref = write_body(tmp, "th-real-ref.test.ts",
                           'test.fails("#?.1: only one", () => {})\n'
                           'it.fails("#?.2: two", () => {})\n'
                           "// already fixed in #42.3\n")
    log = tmp / "th-real-ref.jsonl"
    r = run_cli(["ticket", "--title", "T", "--test", str(real_ref)],
                env_extra={"STUB_ARGV_LOG": str(log),
                           "STUB_JSON": "https://github.com/acme/widgets/issues/9"},
                body_file=body)
    check("real #<n> reference for another issue: does not refuse",
          "outside a well-formed" not in r.stderr, r.stderr)

    hint_repo = tmp / "th-hint-workflow"
    (hint_repo / ".git").mkdir(parents=True)
    (hint_repo / ".Workflow").mkdir()
    log = tmp / "th-no-test.jsonl"
    r = run_cli(["ticket", "--title", "T"],
                env_extra={"STUB_ARGV_LOG": str(log),
                           "STUB_JSON": "https://github.com/acme/widgets/issues/55"},
                body_file=write_body(tmp, "th-no-test-body.md", TICKET_BODY_OK),
                cwd=hint_repo)
    check("no --test, .Workflow marker present: exits 0",
          r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("no --test, .Workflow marker present: hint on stderr naming --test",
          "--test" in r.stderr and "hint" in r.stderr, r.stderr)
    check("no --test, .Workflow marker present: issue URL still printed on stdout",
          "issues/55" in r.stdout, r.stdout)

    no_hint_repo = tmp / "th-hint-none"
    (no_hint_repo / ".git").mkdir(parents=True)
    ticket_body_no_warnings = (
        "## Acceptance criteria\n\n- [ ] `npm test` exits 0\n\n"
        "## Files claimed\n\n- None, no files.\n"
    )
    log = tmp / "th-no-test-no-marker.jsonl"
    r = run_cli(["ticket", "--title", "T"],
                env_extra={"STUB_ARGV_LOG": str(log),
                           "STUB_JSON": "https://github.com/acme/widgets/issues/56"},
                body_file=write_body(tmp, "th-no-test-body2.md", ticket_body_no_warnings),
                cwd=no_hint_repo)
    check("no --test, no .Workflow marker: exits 0",
          r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("no --test, no .Workflow marker: no hint (there is no lane 04 here)",
          r.stderr.strip() == "", r.stderr)
    check("no --test, no .Workflow marker: issue URL still printed on stdout",
          "issues/56" in r.stdout, r.stdout)

    repo, remote = make_git_repo(tmp / "th-success")
    test_file = repo / "tests" / "acceptance.test.ts"
    test_file.parent.mkdir(parents=True, exist_ok=True)
    test_file.write_text(TEST_FILE_TWO_TITLES)
    log = tmp / "th-success.jsonl"
    r = run_cli(["ticket", "--title", "T", "--test", "tests/acceptance.test.ts"],
                env_extra={"STUB_ARGV_LOG": str(log),
                           "STUB_JSON": "https://github.com/acme/widgets/issues/101"},
                body_file=write_body(tmp, "th-success-body.md", TICKET_BODY_TWO_CRITERIA),
                cwd=repo)
    check("success: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("success: no leftover no-test hint (a test was handed over)",
          "hint" not in r.stderr, r.stderr)
    check("success: prints the issue URL", "issues/101" in r.stdout, r.stdout)
    rewritten = test_file.read_text()
    check("success: placeholder rewritten to the real issue number",
          "#101.1:" in rewritten and "#101.2:" in rewritten and "#?." not in rewritten,
          rewritten)
    status = _git(["status", "--short"], cwd=repo)
    check("success: working tree clean (committed)", status.stdout.strip() == "", status.stdout)
    remote_log = _git(["log", "--oneline", "-1", "work"], cwd=remote)
    check("success: commit reached the remote (pushed)",
          "Test for #101" in remote_log.stdout, remote_log.stdout)

    repo_stub, remote_stub = make_git_repo(tmp / "th-stub")
    stub_test_file = repo_stub / "tests" / "acceptance.test.ts"
    stub_test_file.parent.mkdir(parents=True, exist_ok=True)
    stub_test_file.write_text(TEST_FILE_TWO_TITLES)
    stub_subject_file = repo_stub / "src" / "thing.ts"
    stub_subject_file.parent.mkdir(parents=True, exist_ok=True)
    stub_subject_file.write_text(
        "export function doTheFirstThing(): never { throw new Error('not built yet') }\n"
    )
    log = tmp / "th-stub.jsonl"
    r = run_cli(["ticket", "--title", "T",
                 "--test", "tests/acceptance.test.ts", "--test", "src/thing.ts"],
                env_extra={"STUB_ARGV_LOG": str(log),
                           "STUB_JSON": "https://github.com/acme/widgets/issues/303"},
                body_file=write_body(tmp, "th-stub-body.md", TICKET_BODY_TWO_CRITERIA),
                cwd=repo_stub)
    check("stub subject file: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    check("stub subject file: unchanged (it had no '#?' to rewrite)",
          stub_subject_file.read_text() == (
              "export function doTheFirstThing(): never { throw new Error('not built yet') }\n"
          ),
          stub_subject_file.read_text())
    committed_files = _git(["show", "--stat", "--format=", "HEAD"], cwd=repo_stub).stdout
    check("stub subject file: committed alongside the test file",
          "src/thing.ts" in committed_files and "tests/acceptance.test.ts" in committed_files,
          committed_files)
    remote_log_stub = _git(["log", "--oneline", "-1", "work"], cwd=remote_stub)
    check("stub subject file: the commit reached the remote too",
          "Test for #303" in remote_log_stub.stdout, remote_log_stub.stdout)

    repo2, remote2 = make_git_repo(tmp / "th-failure")
    test_file2 = repo2 / "tests" / "acceptance.test.ts"
    test_file2.parent.mkdir(parents=True, exist_ok=True)
    test_file2.write_text(TEST_FILE_TWO_TITLES)
    pre_receive = remote2 / "hooks" / "pre-receive"
    pre_receive.write_text("#!/bin/sh\necho 'refused by remote' >&2\nexit 1\n")
    pre_receive.chmod(0o755)
    log = tmp / "th-failure.jsonl"
    r = run_cli(["ticket", "--title", "T", "--test", "tests/acceptance.test.ts"],
                env_extra={"STUB_ARGV_LOG": str(log),
                           "STUB_JSON": "https://github.com/acme/widgets/issues/202"},
                body_file=write_body(tmp, "th-failure-body.md", TICKET_BODY_TWO_CRITERIA),
                cwd=repo2)
    check("git failure: exits nonzero", r.returncode != 0, r.returncode)
    check("git failure: prints git's own failure output",
          "refused by remote" in r.stderr, r.stderr)
    check("git failure: names the issue number that does exist", "#202" in r.stderr, r.stderr)
    check("git failure: tells the caller the files are staged/committed locally",
          "staged/committed locally" in r.stderr, r.stderr)
    check("git failure: names what to do (push) and the routing consequence",
          "push" in r.stderr and "acceptance author" in r.stderr, r.stderr)
    local_log = _git(["log", "--oneline", "-1"], cwd=repo2)
    check("git failure: the rewritten test is still committed locally",
          "Test for #202" in local_log.stdout, local_log.stdout)

    repo3, remote3 = make_git_repo(tmp / "th-ticketify")
    test_file3 = repo3 / "tests" / "acceptance.test.ts"
    test_file3.parent.mkdir(parents=True, exist_ok=True)
    test_file3.write_text('test.fails("#?.1: does the first thing", () => {})\n')
    supplied = ("## Acceptance criteria\n\n- [ ] the first thing works - check: `true`\n\n"
                "## Files claimed\n\n- tests/acceptance.test.ts\n")
    log = tmp / "th-ticketify.jsonl"
    env = {"STUB_ARGV_LOG": str(log), "STUB_JSON": json.dumps(
        issue_obj(77, 7777, "fuzzy body", labels=["fuzzy"]))}
    body3 = tmp / "th-ticketify-supplied.md"
    body3.write_text(supplied)
    r = subprocess.run(
        [sys.executable, str(FILE_ISSUE), "ticketify", "77", "--test",
         "tests/acceptance.test.ts", "--body-file", str(body3)],
        capture_output=True, text=True, env={**ROWLOG.env(), "AGENT_SKILLS_GH": str(STUB_GH), **env},
        cwd=repo3,
    )
    check("ticketify --test: exits 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr}")
    rewritten3 = test_file3.read_text()
    check("ticketify --test: placeholder rewritten to #77",
          "#77.1:" in rewritten3 and "#?." not in rewritten3, rewritten3)
    remote_log3 = _git(["log", "--oneline", "-1", "work"], cwd=remote3)
    check("ticketify --test: commit reached the remote",
          "Test for #77" in remote_log3.stdout, remote_log3.stdout)

    repo4, _remote4 = make_git_repo(tmp / "th-no-number")
    test_file4 = repo4 / "tests" / "acceptance.test.ts"
    test_file4.parent.mkdir(parents=True, exist_ok=True)
    test_file4.write_text(TEST_FILE_TWO_TITLES)
    log = tmp / "th-no-number.jsonl"
    r = run_cli(["ticket", "--title", "T", "--test", "tests/acceptance.test.ts"],
                env_extra={"STUB_ARGV_LOG": str(log), "STUB_JSON": "not a url"},
                body_file=write_body(tmp, "th-no-number-body.md", TICKET_BODY_TWO_CRITERIA),
                cwd=repo4)
    check("no parseable issue number: exits nonzero", r.returncode != 0, r.returncode)
    check("no parseable issue number: says the number could not be read",
          "could not be read" in r.stderr, r.stderr)
    check("no parseable issue number: says the placeholders were not rewritten",
          "not rewritten" in r.stderr, r.stderr)
    check("no parseable issue number: says nothing was committed",
          "nothing was committed" in r.stderr, r.stderr)
    check("no parseable issue number: the test file was left untouched",
          test_file4.read_text() == TEST_FILE_TWO_TITLES, test_file4.read_text())
    staged4 = _git(["diff", "--cached", "--stat"], cwd=repo4)
    check("no parseable issue number: nothing staged",
          staged4.stdout.strip() == "", staged4.stdout)
    log4 = _git(["log", "--oneline"], cwd=repo4)
    check("no parseable issue number: no new commit made",
          log4.stdout.count("\n") == 1, log4.stdout)


def test_immutable_set_claim(tmp):
    print("#425: a '## Files claimed' path inside the immutable set is refused before gh runs")

    log = tmp / "immutable-ticket.jsonl"
    body = write_body(tmp, "ticket-claims-ci.md", TICKET_BODY_CLAIMS_CI)
    r = run_cli(["ticket", "--title", "A ticket"], env_extra={"STUB_ARGV_LOG": str(log)},
                body_file=body)
    check("ticket/claims .github/workflows/ci.yml: exits nonzero", r.returncode != 0, r.returncode)
    check("ticket/claims .github/workflows/ci.yml: refusal names the path",
          ".github/workflows/ci.yml" in r.stderr, r.stderr)
    check("ticket/claims .github/workflows/ci.yml: never called gh",
          read_argv_log(log) == [], read_argv_log(log))

    log = tmp / "immutable-ticketify.jsonl"
    issues = [issue_obj(40, 4040, "Some fuzzy description.\n", labels=["fuzzy"])]
    r, calls = run_ticketify(40, [], issues, TICKET_BODY_CLAIMS_CI, log)
    check("ticketify/claims .github/workflows/ci.yml: exits nonzero", r.returncode != 0, r.returncode)
    check("ticketify/claims .github/workflows/ci.yml: refusal names the path",
          ".github/workflows/ci.yml" in r.stderr, r.stderr)
    check("ticketify/claims .github/workflows/ci.yml: never called gh", calls == [], calls)


def test_run_row(tmp: Path):
    print("one run row per invocation, filed or refused")
    r = run_cli(["ticket", "--title", "A ticket"],
                env_extra={"STUB_ARGV_LOG": str(tmp / "row-argv.jsonl")},
                body_file=write_body(tmp, "row-good.md", TICKET_BODY_OK))
    rows = ROWLOG.last("file-issue")
    check("a filed ticket writes one row, verdict=filed, kind=ticket",
          r.returncode == 0 and len(rows) == 1 and rows[0].get("verdict") == "filed"
          and rows[0].get("kind") == "ticket", f"rc={r.returncode} rows={rows}")

    r = run_cli(["ticket", "--title", "A ticket"],
                body_file=write_body(tmp, "row-bad.md", "No headings at all.\n"))
    rows = ROWLOG.last("file-issue")
    check("a shape refusal writes one row, verdict=refused, kind still named",
          r.returncode != 0 and len(rows) == 1 and rows[0].get("verdict") == "refused"
          and rows[0].get("kind") == "ticket", f"rc={r.returncode} rows={rows}")
    check("the row names the tool, not a hook",
          rows and rows[0].get("tool") == "file-issue", str(rows))


def main():
    with tempfile.TemporaryDirectory(prefix="file-issue-test-") as tmp_str:
        tmp = Path(tmp_str)
        test_validator()
        print()
        test_check_marker()
        print()
        test_config_or_md_evidence()
        print()
        test_bind_gh_repo_binding(tmp)
        print()
        test_cli(tmp)
        print()
        test_ticketify(tmp)
        print()
        test_by_hand_label(tmp)
        print()
        test_test_handoff(tmp)
        print()
        test_immutable_set_claim(tmp)
        print()
        test_run_row(tmp)

    ROWLOG.cleanup()
    finish("All file-issue checks passed.")


if __name__ == "__main__":
    main()
