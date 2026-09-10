#!/usr/bin/env python3
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness

REPO = next((c for c in (Path(__file__).resolve().parents[1], Path(__file__).resolve().parents[2]) if (c / "bin").is_dir()), Path(__file__).resolve().parents[1])
HOOK = REPO / "bin" / "clone-check"

MIN_TOKENS = 20
MIN_LINES = 5

FIXTURE_CONFIG = {
    "path": ".",
    "format": ["python"],
    "minTokens": MIN_TOKENS,
    "minLines": MIN_LINES,
    "exclude": [],
    "ignoreExtensions": [{"ext": ".json", "reason": "the fixture's own config file"}],
}

FILLER_A = "# " + " ".join(f"alpha_filler_{i}" for i in range(30)) + "\n"
FILLER_B = "# " + " ".join(f"beta_filler_{i}" for i in range(30)) + "\n"

DUP_BLOCK = '''def handle_request(payload):
    if not isinstance(payload, dict):
        raise ValueError("payload must be a dict")
    normalized = {k.strip(): v for k, v in payload.items() if v is not None}
    for key, value in sorted(normalized.items()):
        print(key, "=", value)
    return normalized
'''

SHORT_BLOCK = '''def ping():
    return "pong"
'''

OTHER_BLOCK = '''def render_summary(rows):
    totals = [row.amount for row in rows if row.amount]
    header = "summary for {} entries".format(len(rows))
    footer = "grand total {}".format(sum(totals))
    return "\\n".join([header] + [str(t) for t in totals] + [footer])
'''

BASELINE_NAME = ".clone-baseline.json"


def make_fixture(root: Path, filler_a: str, filler_b: str, shared_block: str) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / ".clone-check.json").write_text(json.dumps(FIXTURE_CONFIG))
    (root / "a.py").write_text(f"{filler_a}\n{shared_block}\n")
    (root / "b.py").write_text(f"{filler_b}\n{shared_block}\n")


def make_config_fixture(root: Path, **overrides) -> Path:
    make_fixture(root, FILLER_A, FILLER_B, DUP_BLOCK)
    cfg = {**FIXTURE_CONFIG, **overrides}
    (root / ".clone-check.json").write_text(json.dumps(cfg))
    return root


ROWLOG = _harness.RowLog("clone-check-log-")


def run(cwd: Path, stdin_bytes: bytes = b""):
    return _harness.run_hook(HOOK, stdin_bytes, cwd=str(cwd), env=ROWLOG.env())


def run_flag(cwd: Path, *flags: str):
    proc = subprocess.run(
        [sys.executable, str(HOOK), *flags],
        capture_output=True, cwd=str(cwd), timeout=_harness.HOOK_TIMEOUT,
        env=ROWLOG.env(),
    )
    return _harness.HookRun(proc, {}, {}, False)


def baseline_fixture(root: Path, entries=None, name: str = BASELINE_NAME) -> Path:
    make_config_fixture(root, baseline=name)
    if entries is not None:
        (root / name).write_text(json.dumps({"clones": entries}))
    return root


def recorded_entries(root: Path, name: str = BASELINE_NAME) -> list[dict]:
    return json.loads((root / name).read_text())["clones"]


def combined(result) -> str:
    return result.proc.stdout.decode() + result.proc.stderr.decode()


def main():
    print("test_clone_check: bin/clone-check reports duplication above threshold, "
          "stays silent below it")

    with tempfile.TemporaryDirectory() as td:
        above_root = Path(td) / "above"
        make_fixture(above_root, FILLER_A, FILLER_B, DUP_BLOCK)
        result = run(above_root)
        out = result.proc.stdout.decode()
        _harness.check(
            "above-threshold duplication is reported (exit 1)",
            result.proc.returncode == 1,
            f"returncode={result.proc.returncode!r} stdout={out!r}",
        )
        _harness.check(
            "above-threshold finding names both fixture files",
            "a.py" in out and "b.py" in out,
            f"stdout did not name both files: {out!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        below_root = Path(td) / "below"
        make_fixture(below_root, FILLER_A, FILLER_B, SHORT_BLOCK)
        result = run(below_root)
        _harness.check(
            "below-threshold duplication is not reported (exit 0)",
            result.proc.returncode == 0,
            f"returncode={result.proc.returncode!r} stdout={result.proc.stdout.decode()!r}",
        )

        for name, stdin_bytes in _harness.MALFORMED_STDIN:
            result = run(below_root, stdin_bytes)
            _harness.check(
                f"malformed stdin ({name}) does not affect the verdict",
                result.proc.returncode == 0,
                f"returncode={result.proc.returncode!r} for stdin case {name!r}",
            )

    with tempfile.TemporaryDirectory() as td:
        root = make_config_fixture(Path(td) / "shebang")
        (root / "a.py").unlink()
        (root / "runner").write_text(f"#!/usr/bin/env python3\n{FILLER_A}\n{DUP_BLOCK}\n")
        result = run(root)
        out = combined(result)
        _harness.check(
            "an extensionless python-shebang file is scanned and its clone reported",
            result.proc.returncode == 1 and "runner" in out,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )
        _harness.check(
            "the shebang-resolved file is counted in the scanned-file banner",
            "across 2 file(s)" in out,
            f"banner did not count both files: {out!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        root = make_config_fixture(Path(td) / "unknown-shebang")
        (root / "script").write_text("#!/usr/bin/env ruby\nputs 1\n")
        result = run(root)
        out = combined(result)
        _harness.check(
            "an unrecognized shebang lands in the empty-extension bucket, not a silent skip",
            result.proc.returncode == 1 and "no recognized shebang" in out,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )
        ignored = make_config_fixture(
            Path(td) / "ignored-shebang",
            ignoreExtensions=FIXTURE_CONFIG["ignoreExtensions"]
            + [{"ext": "", "reason": "fixture data with no recognized shebang"}],
        )
        (ignored / "script").write_text("#!/usr/bin/env ruby\nputs 1\n")
        result = run(ignored)
        _harness.check(
            "the empty-extension bucket is satisfiable by an ignoreExtensions entry",
            result.proc.returncode == 1 and "a.py" in result.proc.stdout.decode(),
            f"returncode={result.proc.returncode!r} out={combined(result)!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        root = make_config_fixture(Path(td) / "uncovered")
        (root / "notes.rb").write_text("puts 'hello'\n")
        (root / "more.rb").write_text("puts 'world'\n")
        result = run(root)
        out = combined(result)
        for label, needle in (
            ("names the uncovered extension", ".rb"),
            ("names its file count", "2 file(s)"),
            ("names an example path", "e.g. more.rb"),
            ("names the `format` fix", "format"),
            ("names the `ignoreExtensions` fix", "ignoreExtensions"),
        ):
            _harness.check(
                f"an uncovered extension {label}",
                needle in out,
                f"missing {needle!r} from: {out!r}",
            )
        _harness.check(
            "an uncovered extension exits 1",
            result.proc.returncode == 1,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )
        _harness.check(
            "an uncovered extension refuses BEFORE scanning: no clone banner is printed",
            "clone(s) found" not in out and "0 clones" not in out,
            f"the scan ran anyway: {out!r}",
        )
        _harness.check(
            "naming the bucket in ignoreExtensions lets the same tree scan",
            run(make_config_fixture(
                Path(td) / "covered",
                ignoreExtensions=FIXTURE_CONFIG["ignoreExtensions"]
                + [{"ext": ".rb", "reason": "fixture data, not authored source"}],
            )).proc.returncode == 1,
            "with .rb ignored the scan should run and report the a.py/b.py clone",
        )

    with tempfile.TemporaryDirectory() as td:
        root = make_config_fixture(Path(td) / "symlink")
        (root / "b.py").unlink()
        (root / "b.py").symlink_to("a.py")
        result = run(root)
        out = combined(result)
        _harness.check(
            "a symlink is not a clone of its own target (exit 0)",
            result.proc.returncode == 0,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )
        _harness.check(
            "the symlink is skipped before the scan, not scanned and forgiven",
            "across 1 file(s)" in out,
            f"banner counted the symlink as a scanned file: {out!r}",
        )

        both = make_config_fixture(Path(td) / "symlink-and-copy")
        (both / "installed.py").symlink_to("a.py")
        result = run(both)
        out = combined(result)
        _harness.check(
            "a hand-copied pair is still reported when a symlink is in the tree",
            result.proc.returncode == 1 and "a.py" in out and "b.py" in out
            and "installed.py" not in out,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "no-key"
        make_fixture(root, FILLER_A, FILLER_B, DUP_BLOCK)
        without = {k: v for k, v in FIXTURE_CONFIG.items() if k != "ignoreExtensions"}
        (root / ".clone-check.json").write_text(json.dumps(without))
        result = run(root)
        out = combined(result)
        _harness.check(
            "a config with no ignoreExtensions key exits nonzero from load_config",
            result.proc.returncode != 0 and "missing required key 'ignoreExtensions'" in out,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )

        reasonless = make_config_fixture(
            Path(td) / "no-reason", ignoreExtensions=[{"ext": ".json"}]
        )
        result = run(reasonless)
        out = combined(result)
        _harness.check(
            "an ignoreExtensions entry with no reason exits nonzero",
            result.proc.returncode != 0 and "reason" in out,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )


    with tempfile.TemporaryDirectory() as td:
        root = baseline_fixture(Path(td) / "record")
        result = run_flag(root, "--record-baseline")
        out = combined(result)
        _harness.check(
            "--record-baseline still exits 1",
            result.proc.returncode == 1,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )
        _harness.check(
            "--record-baseline says a baseline was recorded and must ratchet to empty",
            "recorded" in out and BASELINE_NAME in out and "shrink" in out,
            f"out={out!r}",
        )
        _harness.check(
            "--record-baseline writes the file it was told to write",
            (root / BASELINE_NAME).is_file(),
            f"{BASELINE_NAME} not written; out={out!r}",
        )

        entries = recorded_entries(root)
        _harness.check(
            "the recorded entry names both paths and a content hash, and no line numbers",
            len(entries) == 1
            and sorted((entries[0]["a"], entries[0]["b"])) == ["a.py", "b.py"]
            and isinstance(entries[0].get("hash"), str)
            and entries[0]["hash"],
            f"entries={entries!r}",
        )

        result = run(root)
        out = combined(result)
        _harness.check(
            "a clone whose pair is in the baseline does not fail the run",
            result.proc.returncode == 0,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )
        _harness.check(
            "the banner carries the baselined count next to the file count",
            "1 baselined" in out and "across 2 file(s)" in out,
            f"out={out!r}",
        )

        (root / "a.py").write_text(
            "# " + " ".join(f"gamma_drift_{i}" for i in range(12)) + "\n"
            + (root / "a.py").read_text()
        )
        result = run(root)
        _harness.check(
            "a recorded entry survives line-number drift above the clone",
            result.proc.returncode == 0,
            f"returncode={result.proc.returncode!r} out={combined(result)!r}",
        )

        swapped = [{**entries[0], "a": entries[0]["b"], "b": entries[0]["a"]}]
        (root / BASELINE_NAME).write_text(json.dumps({"clones": swapped}))
        _harness.check(
            "a baseline entry matches regardless of which path is written first",
            run(root).proc.returncode == 0,
            f"out={combined(run(root))!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        root = baseline_fixture(Path(td) / "stale")
        run_flag(root, "--record-baseline")
        entry = recorded_entries(root)[0]

        (root / "b.py").write_text(FILLER_B)
        result = run(root)
        out = combined(result)
        _harness.check(
            "a baseline entry matching no current clone fails the run",
            result.proc.returncode == 1,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )
        _harness.check(
            "the stale entry is named, with the rule that the file only shrinks",
            "stale" in out and "a.py" in out and "b.py" in out and "shrink" in out,
            f"out={out!r}",
        )

        (root / BASELINE_NAME).write_text(json.dumps({"clones": []}))
        _harness.check(
            "trimming the stale entry makes the same tree green",
            run(root).proc.returncode == 0,
            f"out={combined(run(root))!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        root = baseline_fixture(Path(td) / "unrecorded")
        run_flag(root, "--record-baseline")
        (root / "c.py").write_text(OTHER_BLOCK)
        (root / "d.py").write_text(OTHER_BLOCK)
        result = run(root)
        out = combined(result)
        _harness.check(
            "a clone absent from the baseline still fails the run",
            result.proc.returncode == 1 and "c.py" in out and "d.py" in out,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )
        _harness.check(
            "the banner separates the new clone from the baselined one",
            "1 clone(s) found, 1 baselined" in out,
            f"out={out!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        root = baseline_fixture(Path(td) / "self-skip", name="clone-baseline.rec")
        run_flag(root, "--record-baseline")
        result = run(root)
        out = combined(result)
        _harness.check(
            "the baseline file is skipped by the coverage audit and the scan",
            result.proc.returncode == 0 and ".rec" not in out,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        root = baseline_fixture(Path(td) / "changed", entries=[
            {"a": "a.py", "b": "b.py", "tokens": 40, "hash": "0" * 16},
        ])
        result = run(root)
        out = combined(result)
        _harness.check(
            "a stale entry and an unbaselined clone are both reported, exit 1",
            result.proc.returncode == 1 and "stale" in out and "1 clone(s) found" in out,
            f"returncode={result.proc.returncode!r} out={out!r}",
        )

    with tempfile.TemporaryDirectory() as td:
        clean = Path(td) / "no-baseline"
        make_fixture(clean, FILLER_A, FILLER_B, SHORT_BLOCK)
        out = combined(run(clean))
        _harness.check(
            "a run with no baseline key still reports a baselined count",
            "0 baselined" in out and "across 2 file(s)" in out,
            f"out={out!r}",
        )

    print("\ntest_clone_check: one run row per invocation, written with no shared import")
    _harness.check(
        "clone-check imports no helper module from the home repo's hooks",
        "_hook" not in HOOK.read_text(),
        "clone-check must stay stdlib-only; it is vendored into repos that have neither",
    )

    with tempfile.TemporaryDirectory() as td:
        clean_root = Path(td) / "clean"
        make_fixture(clean_root, FILLER_A, FILLER_B, "")
        (clean_root / ".clone-check.json").write_text(json.dumps(FIXTURE_CONFIG))
        run(clean_root)
        rows = ROWLOG.last("clone-check")
        _harness.check(
            "a clean scan writes exactly one row, verdict=clean, with the file count",
            len(rows) == 1 and rows[0].get("verdict") == "clean"
            and rows[0].get("clones") == 0 and rows[0].get("files", 0) > 0,
            str(rows),
        )
        _harness.check(
            "the row names the repo it scanned, so --repo can filter on it",
            rows and rows[0].get("repo") == clean_root.name, str(rows),
        )
        _harness.check(
            "the row carries its own wall time",
            rows and isinstance(rows[0].get("seconds"), float), str(rows),
        )

        dirty_root = Path(td) / "dirty"
        make_fixture(dirty_root, FILLER_A, FILLER_B, DUP_BLOCK)
        (dirty_root / ".clone-check.json").write_text(json.dumps(FIXTURE_CONFIG))
        run(dirty_root)
        rows = ROWLOG.last("clone-check")
        _harness.check(
            "a scan that finds duplication writes verdict=clones with the count",
            len(rows) == 1 and rows[0].get("verdict") == "clones"
            and rows[0].get("clones", 0) > 0, str(rows),
        )

        refused_root = make_config_fixture(Path(td) / "refused-row", format=["python"],
                                           ignoreExtensions=[])
        run(refused_root)
        rows = ROWLOG.last("clone-check")
        _harness.check(
            "a refused config still writes a row, verdict=refused",
            len(rows) == 1 and rows[0].get("verdict") == "refused", str(rows),
        )

        blocked = _harness.run_hook(HOOK, b"", cwd=str(dirty_root),
                                    env=dict(ROWLOG.env(), STOP_GATE_LOG_DIR="/dev/null/nope"))
        _harness.check(
            "an unwritable log dir leaves the exit code alone",
            blocked.proc.returncode == 1, f"rc={blocked.proc.returncode}",
        )

    with tempfile.TemporaryDirectory() as td:
        recorded_root = baseline_fixture(Path(td) / "row-record")
        run_flag(recorded_root, "--record-baseline")
        rows = ROWLOG.last("clone-check")
        _harness.check(
            "--record-baseline writes verdict=recorded with what it recorded",
            len(rows) == 1 and rows[0].get("verdict") == "recorded"
            and rows[0].get("baselined", 0) > 0, str(rows),
        )

        run(recorded_root)
        rows = ROWLOG.last("clone-check")
        _harness.check(
            "a fully baselined scan is clean, and says how much it is not looking at",
            len(rows) == 1 and rows[0].get("verdict") == "clean"
            and rows[0].get("clones") == 0 and rows[0].get("baselined", 0) > 0, str(rows),
        )

        stale_root = baseline_fixture(Path(td) / "row-stale", entries=[
            {"a": "a.py", "b": "b.py", "tokens": 40, "hash": "0" * 16},
        ])
        run(stale_root)
        rows = ROWLOG.last("clone-check")
        _harness.check(
            "a stale entry outranks the clone it no longer matches, verdict=stale",
            len(rows) == 1 and rows[0].get("verdict") == "stale"
            and rows[0].get("stale", 0) > 0, str(rows),
        )

    ROWLOG.cleanup()
    _harness.finish()


if __name__ == "__main__":
    main()
