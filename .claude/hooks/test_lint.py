#!/usr/bin/env python3
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import HOOK_TIMEOUT, check, finish

HOOKS = Path(__file__).resolve().parent
REPO = next((c for c in (HOOKS.parent, HOOKS.parent.parent) if (c / "bin").is_dir()), HOOKS.parent)
LINT = REPO / "bin" / "lint"
LOG_ROW = REPO / "bin" / "log-row"
RULE = "[lint] bare-bin-path"
ROWLOG = _harness.RowLog("lint-log-")

TRIP_FILE = HOOKS / "_lint_trip_fixture.py"
TRIP_SLUG = "duplicated-code/hook-name-constant"
TRIP_BODY = '#!/usr/bin/env python3\n"""Fixture for test_lint.py, removed in a finally."""\n' \
            + "HOOK_NAME" + ' = "restated-literal"\n'


def run_lint_on(files: dict[str, str]) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "bin").mkdir()
        shutil.copy(LINT, root / "bin" / "lint")
        for rel, text in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        proc = subprocess.run(
            ["bash", str(root / "bin" / "lint")],
            capture_output=True, text=True, timeout=HOOK_TIMEOUT,
        )
        return proc.returncode, proc.stdout


def run_lint() -> tuple[subprocess.CompletedProcess, list[dict]]:
    proc = subprocess.run([str(LINT)], capture_output=True, text=True,
                          cwd=str(REPO), env=ROWLOG.env())
    return proc, ROWLOG.last("lint")


def check_bare_bin_path() -> None:
    print("bare-bin-path: a repo-relative bin/ reference in a skill's markdown")
    code, out = run_lint_on({
        ".claude/skills/foo/SKILL.md": "Then run `bin/close-ticket <n> <base>..<head> <checkout>`.\n",
    })
    check("rule fires", RULE in out, out)
    check("hit names the file and line", ".claude/skills/foo/SKILL.md:1" in out, out)
    check("lint exits 1", code == 1, str(code))

    print("bare-bin-path: a hook's own hint text is in scope; docs/agents/ is Workflow's own lane doc, not a seed mirrored into other checkouts, so it stays out")
    code, out = run_lint_on({
        ".claude/hooks/close-gate.py": 'return f"bin/close-ticket {n} <base>..<head>"\n',
        "docs/agents/issue-tracker.md": "- **Close**: `bin/close-ticket <issue>`\n",
    })
    check("hook source fires", ".claude/hooks/close-gate.py:1" in out, out)
    check("docs/agents stays out of scope", "docs/agents/issue-tracker.md:1" not in out, out)

    print("bare-bin-path: machine-absolute paths never fire")
    code, out = run_lint_on({
        ".claude/skills/foo/SKILL.md": (
            "`~/bin/file-issue`, `~/.agents/skills/bin/close-ticket`, "
            "`$HOME/bin/publish-issue-graph`, `#!/usr/bin/env python3`\n"
        ),
    })
    check("rule silent on absolute paths", RULE not in out, out)
    check("lint exits 0", code == 0, str(code) + out)

    print("bare-bin-path: a hook line that branches on the vendored copy is the one place a bare path is right")
    code, out = run_lint_on({
        ".claude/hooks/close-gate.py": (
            'tool = "bin/close-ticket" if vendored else "~/.agents/skills/bin/close-ticket"\n'
            "# a bare `bin/close-ticket` runs\n"
            "# only where the checkout vendors one\n"
        ),
    })
    check("rule silent on a vendored branch", RULE not in out, out)

    print("bare-bin-path: harness fixtures and this repo's own contract are out of scope")
    code, out = run_lint_on({
        ".claude/hooks/test_file_issue.py": '"## Files claimed\\n\\n- bin/file-issue\\n"\n',
        ".claude/contract.json": '{"test": {"cmd": "bin/clone-check"}}\n',
    })
    check("rule silent on fixtures", RULE not in out, out)


def check_run_row() -> None:
    print("\nrun row: a clean run")
    proc, rows = run_lint()
    check("clean lint exits 0", proc.returncode == 0, proc.stdout[-400:])
    check("one row per invocation", len(rows) == 1, str(rows))
    row = rows[0] if rows else {}
    check("verdict is clean", row.get("verdict") == "clean", row)
    check("hits is an empty map, not a missing field", row.get("hits") == {}, row)
    check("row names the tool, not a hook",
          row.get("tool") == "lint" and "hook" not in row, row)
    check("event is bin", row.get("event") == "bin", row)
    check("row carries lint's own wall time, not the shim's",
          isinstance(row.get("seconds"), float) and row["seconds"] > 0.001, row)
    check("row names the repo it linted", row.get("project") == REPO.name, row)

    print("\nrun row: a run with one violation")
    try:
        TRIP_FILE.write_text(TRIP_BODY)
        proc, rows = run_lint()
        check("a violation exits 1", proc.returncode == 1, proc.stdout[-400:])
        check("the violation is reported on stdout as before",
              TRIP_SLUG in proc.stdout, proc.stdout[-400:])
        check("one row per invocation, still", len(rows) == 1, str(rows))
        row = rows[0] if rows else {}
        check("verdict is hit", row.get("verdict") == "hit", row)
        check("hits maps the slug to its count",
              row.get("hits", {}).get(TRIP_SLUG) == 1, row)
        check("only nonzero rules appear; this is what makes a zero-fire slug findable",
              list(row.get("hits", {})) == [TRIP_SLUG], row)
    finally:
        TRIP_FILE.unlink(missing_ok=True)

    print("\nrun row: the round trip back to a clean tree")
    proc, rows = run_lint()
    check("the fixture is gone and lint is clean again",
          proc.returncode == 0 and rows and rows[0].get("hits") == {},
          f"rc={proc.returncode} rows={rows}")

    print("\nrun row: bin/log-row is silent and harmless whatever it is handed")
    for label, argv in [
        ("no arguments", []),
        ("a name but no JSON", ["lint"]),
        ("unparseable JSON", ["lint", "{not json"]),
        ("JSON that is not an object", ["lint", "[1, 2, 3]"]),
        ("too many arguments", ["lint", "{}", "extra"]),
    ]:
        proc = subprocess.run([str(LOG_ROW), *argv], capture_output=True, text=True,
                              env=ROWLOG.env())
        check(f"log-row({label}): exit 0, silent",
              proc.returncode == 0 and not proc.stdout and not proc.stderr,
              f"rc={proc.returncode} out={proc.stdout!r} err={proc.stderr!r}")

    print("\nrun row: bin/log-row writes the row it is handed")
    env = ROWLOG.env()
    payload = json.dumps({"verdict": "hit", "hits": {"a/b": 3}, "seconds": 1.25})
    subprocess.run([str(LOG_ROW), "lint", payload], capture_output=True, env=env)
    rows = ROWLOG.last("lint")
    check("the shim's row names the mechanism it was given, never its own stem",
          len(rows) == 1 and rows[0].get("tool") == "lint", str(rows))
    check("the tool's own fields ride through verbatim",
          rows and rows[0].get("hits") == {"a/b": 3} and rows[0].get("seconds") == 1.25,
          str(rows))

    print("\nrun row: an unwritable log dir never fails the gate")
    proc = subprocess.run([str(LINT)], capture_output=True, text=True, cwd=str(REPO),
                          env=dict(ROWLOG.env(), STOP_GATE_LOG_DIR="/dev/null/nope"))
    check("lint's exit code and output are unchanged when the row cannot be written",
          proc.returncode == 0 and not proc.stderr, f"rc={proc.returncode} err={proc.stderr!r}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "bin").mkdir()
        shutil.copy(LINT, root / "bin" / "lint")
        proc = subprocess.run(["bash", str(root / "bin" / "lint")],
                              capture_output=True, text=True, timeout=HOOK_TIMEOUT)
    check("a lint copied without the shim beside it stays quiet on stderr",
          "log-row" not in proc.stderr, proc.stderr[-300:])


def main() -> None:
    check_bare_bin_path()
    check_run_row()
    ROWLOG.cleanup()
    finish("bin/lint: bare-bin-path and run-row checks all passed.")


if __name__ == "__main__":
    main()
