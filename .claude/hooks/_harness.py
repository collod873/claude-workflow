#!/usr/bin/env python3
import inspect
import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, NamedTuple


FAILURES: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    status = "PASS" if cond else "FAIL"
    if not cond:
        FAILURES.append(f"{label}: {detail}")
    print(f"  [{status}] {label}" + (f": {detail}" if detail and not cond else ""))


def finish(success: str = "All checks passed.") -> None:
    print()
    if FAILURES:
        print(f"FAILURES ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print(success)
    sys.exit(0)



HOOK_TIMEOUT = 10


class HookRun(NamedTuple):
    proc: subprocess.CompletedProcess
    output: dict
    hook_specific_output: dict
    denied: bool


def run_hook(hook, stdin_bytes: bytes, timeout: int = HOOK_TIMEOUT,
             env: dict | None = None, cwd=None) -> HookRun:
    proc = subprocess.run(
        [sys.executable, str(hook)], input=stdin_bytes,
        capture_output=True, timeout=timeout, env=env, cwd=cwd,
    )
    output: dict = {}
    if proc.stdout.strip():
        try:
            parsed = json.loads(proc.stdout.decode())
            if isinstance(parsed, dict):
                output = parsed
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
    hso = output.get("hookSpecificOutput") or {}
    denied = hso.get("permissionDecision") == "deny"
    return HookRun(proc, output, hso, denied)



def router_fired(run: HookRun) -> tuple[bool, str]:
    proc = run.proc
    assert proc.returncode == 0, f"exit {proc.returncode}, stderr={proc.stderr!r}"
    assert proc.stderr == b"", f"stderr not empty: {proc.stderr!r}"
    out = proc.stdout.decode().strip()
    if not out:
        return False, ""
    doc = json.loads(out)
    hso = doc["hookSpecificOutput"]
    assert hso["hookEventName"] == "PreToolUse", "hookEventName missing or wrong"
    assert "permissionDecision" not in hso, "router must never decide"
    assert "systemMessage" not in doc, "router must not warn the human"
    return True, hso["additionalContext"]



def spoken(run: HookRun, hook: str) -> str:
    prefix = f"[{hook}]"
    hso = run.hook_specific_output
    channels = {
        "additionalContext": hso.get("additionalContext"),
        "permissionDecisionReason": hso.get("permissionDecisionReason"),
        "reason": run.output.get("reason"),
        "systemMessage": run.output.get("systemMessage"),
    }
    for name, text in channels.items():
        if text is None:
            continue
        assert isinstance(text, str) and text.startswith(prefix), \
            f"{name} must open with {prefix}: {str(text)[:80]!r}"
    system = channels["systemMessage"]
    assert system is None or "\n" not in system, \
        f"systemMessage must be one line: {system[:80]!r}"
    for name in ("additionalContext", "permissionDecisionReason", "reason"):
        if channels[name]:
            return channels[name]
    return ""



def _default_severity(want: str, got: str) -> str:
    return "FN" if want in ("BLOCK", "INJECT") else "FP"


def diff_baseline(results: list[tuple], severity: Callable[[str, str], str] | None = None) -> None:
    caller = Path(inspect.stack()[1].filename)
    baseline_path = caller.with_suffix(".baseline.json")
    baseline_existed = baseline_path.exists()
    prior: dict[tuple, bool] = {}
    if baseline_existed:
        try:
            for row in json.loads(baseline_path.read_text()):
                prior[(row[0], row[1])] = row[4]
        except Exception:
            pass
    regressions = [(row[0], row[1]) for row in results
                   if prior.get((row[0], row[1])) is True and row[4] is False]

    sev_of = severity or _default_severity
    by_cat: dict[str, list[int]] = {}
    fails = []
    for row in results:
        cat, subject, want, got, ok = row[0], row[1], row[2], row[3], row[4]
        extra = row[5] if len(row) > 5 else ""
        by_cat.setdefault(cat, [0, 0])
        by_cat[cat][0 if ok else 1] += 1
        if not ok:
            fails.append((sev_of(want, got), cat, subject, want, got, extra))

    width = max((len(c) for c in by_cat), default=8) + 2
    print(f"{'CATEGORY':<{width}} PASS FAIL")
    for cat in sorted(by_cat):
        p, f = by_cat[cat]
        print(f"  {cat:<{width - 2}} {p:>4} {f:>4}")
    tp = sum(p for p, _ in by_cat.values())
    tf = sum(f for _, f in by_cat.values())
    print(f"  {'TOTAL':<{width - 2}} {tp:>4} {tf:>4}")

    if fails:
        print("\nFAILURES:")
        for sev, cat, subject, want, got, extra in fails:
            print(f"  [{sev}] {cat}: want={want} got={got} :: {subject}")
            if extra:
                print(f"        {extra}")
    if regressions:
        print("\nREGRESSIONS vs baseline:")
        for cat, subject in regressions:
            print(f"  {cat} :: {subject}")

    if not baseline_existed:
        print(f"\nBaseline: none found, creating snapshot at {baseline_path.name}.")
    else:
        print(f"\nBaseline: diffed against {baseline_path.name} ({len(prior)} prior rows).")
    baseline_path.write_text(json.dumps(results, indent=2))
    sys.exit(1 if tf or regressions else 0)



def rows(log_dir, mechanism: str | None = None, days: int | None = None) -> list[dict]:
    cutoff = (datetime.now() - timedelta(days=days)).date() if days is not None else None
    out: list[dict] = []
    try:
        files = sorted(Path(log_dir).glob("*.jsonl"))
    except OSError:
        return out
    for f in files:
        if cutoff is not None:
            try:
                if datetime.strptime(f.stem[-10:], "%Y-%m-%d").date() < cutoff:
                    continue
            except ValueError:
                continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if not isinstance(row, dict):
                continue
            if not row.get("hook") and not row.get("tool"):
                row["hook"] = f.stem[:-11] if len(f.stem) > 11 else f.stem
            if mechanism is not None and row.get("hook", row.get("tool")) != mechanism:
                continue
            out.append(row)
    return out


class RowLog:

    def __init__(self, prefix: str, base: dict | None = None):
        import os as _os
        import tempfile as _tempfile
        self.root = Path(_tempfile.mkdtemp(prefix=prefix))
        self.base = dict(_os.environ) if base is None else dict(base)
        self.n = 0

    def env(self, **extra) -> dict:
        self.n += 1
        return dict(self.base, STOP_GATE_LOG_DIR=str(self.root / str(self.n)), **extra)

    def last(self, mechanism: str | None = None) -> list[dict]:
        return rows(self.root / str(self.n), mechanism)

    def verdicts(self, mechanism: str | None = None) -> list[str]:
        return [r.get("verdict") for r in self.last(mechanism)]

    def cleanup(self) -> None:
        import shutil as _shutil
        _shutil.rmtree(self.root, ignore_errors=True)



MALFORMED_STDIN: list[tuple[str, bytes]] = [
    ("empty", b""),
    ("bad-json", b"not json"),
    ("empty-object", b"{}"),
    ("not-an-object", b"[1, 2, 3]"),
]
