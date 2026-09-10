#!/usr/bin/env python3
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _harness
from _harness import MALFORMED_STDIN, RowLog, check, finish, run_hook, spoken

HOOK = Path(__file__).resolve().parent / "adr-gate.py"


def payload(file_path: str, cwd: str, tool: str = "Write") -> bytes:
    return json.dumps({
        "hook_event_name": "PreToolUse",
        "tool_name": tool,
        "tool_input": {"file_path": file_path},
        "cwd": cwd,
        "session_id": "test-adr-gate",
    }).encode()


def main() -> None:
    log = RowLog("adr-gate-")
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td)
        subprocess.run(["git", "init", "-q", str(repo)], capture_output=True)
        adr = repo / "docs" / "adr"
        adr.mkdir(parents=True)
        existing = adr / "0001-triage-labels-are-positions-not-verdicts.md"
        existing.write_text("# Triage labels are positions, not verdicts\n")
        (adr / "INDEX.md").write_text("# Decisions\n")
        feature_adr = repo / "src" / "features" / "crm" / "docs" / "adr"
        feature_adr.mkdir(parents=True)

        print("adr-gate: refusals")
        run = run_hook(HOOK, payload(str(adr / "0034-a-new-ruling.md"), str(repo)),
                       env=log.env())
        check("a new hand-numbered ADR is refused", run.denied, run.proc.stdout)
        check("the refusal names the tool that files one",
              "new-adr" in spoken(run, "adr-gate"), spoken(run, "adr-gate"))
        check("the refusal names both commands, runnable as written",
              "--land" in spoken(run, "adr-gate"), spoken(run, "adr-gate"))
        check("the refusal states the bar rather than only the mechanic",
              "constraint" in spoken(run, "adr-gate"), spoken(run, "adr-gate"))
        check("exit is 0; JSON and exit 2 are mutually exclusive",
              run.proc.returncode == 0, run.proc.returncode)
        rows = log.last()
        check("a refusal writes exactly one run row", len(rows) == 1, rows)
        check("the row names the guard that fired",
              rows and rows[0].get("guard") == "hand-numbered", rows)

        run = run_hook(HOOK, payload(str(adr / "INDEX.md"), str(repo)), env=log.env())
        check("writing the generated index is refused", run.denied, run.proc.stdout)
        check("that refusal names --fix", "--fix" in spoken(run, "adr-gate"),
              spoken(run, "adr-gate"))
        check("the index guard is its own slug",
              log.last() and log.last()[0].get("guard") == "generated-index", log.last())

        run = run_hook(HOOK, payload(str(adr / "0091-a-ruling.md"), str(repo)), env=log.env())
        check("a hand-numbered root ADR is still refused beside a feature corpus",
              run.denied, run.proc.stdout)

        print("\nadr-gate: the silence cases")
        silent = [
            ("a draft", str(adr / "draft-a-new-ruling.md")),
            ("an existing ADR being corrected in place", str(existing)),
            ("a file outside docs/adr/", str(repo / "src" / "main.py")),
            ("a research note", str(repo / "docs" / "research" / "a-note.md")),
            ("a docs/adr path in a tree that has no such directory",
             str(repo / "other" / "docs" / "adr" / "0034-x.md")),
            ("a landed-shape write under a feature-dir corpus",
             str(feature_adr / "0091-a-ruling.md")),
        ]
        for label, path in silent:
            run = run_hook(HOOK, payload(path, str(repo)), env=log.env())
            check(f"{label} passes silently",
                  not run.denied and run.proc.stdout.strip() == b"",
                  run.proc.stdout)
            check(f"{label} writes no row", log.last() == [], log.last())

        for tool in ("Edit", "MultiEdit", "NotebookEdit"):
            run = run_hook(HOOK, payload(str(existing), str(repo), tool=tool),
                           env=log.env())
            check(f"{tool} on an existing ADR passes", not run.denied, run.proc.stdout)

        print("\nadr-gate: no repo root")
        with tempfile.TemporaryDirectory() as ungit_td:
            ungit = Path(ungit_td)
            ungit_adr = ungit / "docs" / "adr"
            ungit_adr.mkdir(parents=True)
            run = run_hook(HOOK, payload(str(ungit_adr / "0034-a-new-ruling.md"), str(ungit)),
                           env=log.env())
            check("a hand-numbered ADR outside any git repo passes silently",
                  not run.denied and run.proc.stdout.strip() == b"", run.proc.stdout)

        print("\nadr-gate: fails open")
        for label, stdin in MALFORMED_STDIN:
            run = run_hook(HOOK, stdin, env=log.env())
            check(f"malformed stdin ({label}) fails open",
                  not run.denied and run.proc.returncode == 0,
                  (run.proc.returncode, run.proc.stdout))
        run = run_hook(HOOK, json.dumps(
            {"hook_event_name": "PreToolUse", "tool_input": {"file_path": None}}).encode(),
            env=log.env())
        check("a null file_path fails open", not run.denied, run.proc.stdout)

    log.cleanup()
    finish()


if __name__ == "__main__":
    main()
