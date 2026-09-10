#!/usr/bin/env python3
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
PUBLISH_ISSUE_GRAPH = BIN / "publish-issue-graph"
STUB_GH = HOOKS / "stub_gh.py"


ROWLOG = _harness.RowLog("publish-issue-graph-log-")


def run_cli(graph_path, env_extra=None):
    env = ROWLOG.env()
    env["AGENT_SKILLS_GH"] = str(STUB_GH)
    if env_extra:
        env.update(env_extra)
    argv = [sys.executable, str(PUBLISH_ISSUE_GRAPH), str(graph_path), "--repo", "acme/widgets"]
    return subprocess.run(argv, capture_output=True, text=True, env=env)


def write_graph(tmp, name, graph):
    p = tmp / name
    p.write_text(json.dumps(graph))
    return p


def read_argv_log(log_path):
    if not log_path.exists():
        return []
    lines = [ln for ln in log_path.read_text().splitlines() if ln.strip()]
    return [json.loads(ln)["argv"] for ln in lines]


TICKET_BODY_OK = (
    "## Acceptance criteria\n\n- [ ] `hooks/test_publish_issue_graph.py` exists and exits 0\n\n"
    "## Files claimed\n\n- bin/publish-issue-graph\n"
)

TICKET_BODY_MISSING_FILES = (
    "## Acceptance criteria\n\n- [ ] Criterion 1\n"
)


def test_missing_files_claimed(tmp):
    print("graph with an issue body missing '## Files claimed': refused before any create")
    log = tmp / "log1.jsonl"
    graph = {"issues": [
        {"key": "widget-a", "title": "Widget A", "body": TICKET_BODY_MISSING_FILES},
    ]}
    r = run_cli(write_graph(tmp, "missing-files.json", graph), env_extra={"STUB_ARGV_LOG": str(log)})
    check("exits nonzero", r.returncode != 0, r.returncode)
    check("names the offending issue's key", "widget-a" in r.stderr, r.stderr)
    check("names the missing heading", "Files claimed" in r.stderr, r.stderr)
    check("never called gh issue create", read_argv_log(log) == [], read_argv_log(log))


def test_all_valid_proceeds_to_create(tmp):
    print("graph whose issues all validate: proceeds to create, one call per issue")
    log = tmp / "log2.jsonl"
    graph = {"issues": [
        {"key": "widget-a", "title": "Widget A", "body": TICKET_BODY_OK},
        {"key": "widget-b", "title": "Widget B", "body": TICKET_BODY_OK},
    ]}
    r = run_cli(write_graph(tmp, "all-valid.json", graph), env_extra={"STUB_ARGV_LOG": str(log)})
    calls = read_argv_log(log)
    creates = [c for c in calls if c[:2] == ["issue", "create"]]
    check("one gh issue create per issue", len(creates) == len(graph["issues"]), calls)
    titles = {c[c.index("--title") + 1] for c in creates if "--title" in c}
    check("titles match the graph's issues", titles == {"Widget A", "Widget B"}, titles)


def test_run_row(tmp: Path):
    print("one run row per invocation, published or refused")
    graph = write_graph(tmp, "row-valid.json", {"issues": [
        {"key": "row-a", "title": "Row A", "body": TICKET_BODY_OK}]})
    run_cli(graph, env_extra={"STUB_ARGV_LOG": str(tmp / "row-argv.jsonl")})
    rows = ROWLOG.last("publish-issue-graph")
    check("a run that dies mid-way still writes exactly one row", len(rows) == 1, str(rows))
    check("the row names the tool, not a hook",
          rows and rows[0].get("tool") == "publish-issue-graph", str(rows))
    check("the row carries an issue count field to divide by",
          rows and isinstance(rows[0].get("count"), int), str(rows))

    bad = write_graph(tmp, "row-bad.json", {"issues": [
        {"key": "a", "title": "No files claimed", "body": "Nothing here."}]})
    r = run_cli(bad)
    rows = ROWLOG.last("publish-issue-graph")
    check("a refused graph writes one row, verdict=refused",
          r.returncode != 0 and len(rows) == 1 and rows[0].get("verdict") == "refused",
          f"rc={r.returncode} rows={rows}")


def main():
    with tempfile.TemporaryDirectory(prefix="publish-issue-graph-test-") as tmp_str:
        tmp = Path(tmp_str)
        test_missing_files_claimed(tmp)
        print()
        test_all_valid_proceeds_to_create(tmp)
        print()
        test_run_row(tmp)

    ROWLOG.cleanup()
    finish("All publish-issue-graph checks passed.")


if __name__ == "__main__":
    main()
