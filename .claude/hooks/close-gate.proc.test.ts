import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

interface CaseVerdict {
  reason: string;
  spelled: boolean;
  grammar: number;
}

interface GateReading {
  range: CaseVerdict[];
  superseded: CaseVerdict[];
  heading: boolean;
  otherHeading: boolean;
  noDiff: string[];
  supersededRecord: string[];
  markers: Array<string | null>;
}

const HOOKS = dirname(fileURLToPath(import.meta.url));

const RULES = resolve(HOOKS, "..", "..", ".Workflow", "agent-workflows", "shared", "closing-record.rules.json");

const RANGE_CASES = [
  "`3fc1769..7f9d443`",
  "3fc1769..7f9d443",
  "- `3fc1769..7f9d443`",
  "this line names no range at all",
];

const SUPERSEDED_CASES = ["Superseded by #123", "- Superseded by #123"];

const COMMENTS = ["Looks good to me, closing this one.", ""];

const DRIVER = `
import importlib.util
import json
import re
import sys
from pathlib import Path

hooks = Path(sys.argv[1])
sys.path.insert(0, str(hooks))
spec = importlib.util.spec_from_file_location("close_gate_under_test", str(hooks / "close-gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

rules = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
cases = json.loads(sys.argv[3])


def patterns(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [found for item in value for found in patterns(item)]
    if isinstance(value, dict):
        return [found for item in value.values() for found in patterns(item)]
    return []


def classify(sample):
    grammar = []
    for pattern in patterns(rules["grammar"]):
        try:
            compiled = re.compile(pattern, re.MULTILINE)
        except re.error:
            continue
        if compiled.search(sample):
            grammar.append(compiled)
    return grammar


def judge(text, grammar):
    outcome, why, _ = gate.evaluate_record(text, None)
    return {
        "reason": why,
        "spelled": any(compiled.search(text) for compiled in grammar),
        "grammar": len(grammar),
    }


range_grammar = classify(cases["rangeSample"])
superseded_grammar = classify(cases["supersededSample"])
record = rules["heading"] + "\\n\\n" + rules["noDiff"] + "\\n"
other = "## Not the closing record\\n\\n" + rules["noDiff"] + "\\n"

print(json.dumps({
    "range": [judge(text, range_grammar) for text in cases["range"]],
    "superseded": [judge(text, superseded_grammar) for text in cases["superseded"]],
    "heading": gate.find_marker_text(record) is not None,
    "otherHeading": gate.find_marker_text(other) is not None,
    "noDiff": list(gate.evaluate_record(rules["noDiff"], None))[:2],
    "supersededRecord": list(gate.evaluate_record("Superseded by #4242", None))[:2],
    "markers": [gate.find_marker_text(text) for text in cases["comments"]],
}))
`;

function reading(): GateReading {
  const cases = {
    range: RANGE_CASES,
    superseded: SUPERSEDED_CASES,
    comments: COMMENTS,
    rangeSample: RANGE_CASES[0],
    supersededSample: SUPERSEDED_CASES[0],
  };
  const out = execFileSync("python3", ["-c", DRIVER, HOOKS, RULES, JSON.stringify(cases)], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(out) as GateReading;
}

test.fails("#556.2: close-gate.py compiles its parser from the rules source, not its own patterns", () => {
  const read = reading();
  expect(read.heading).toBe(true);
  expect(read.otherHeading).toBe(false);
  for (const verdict of read.range) {
    if (verdict.grammar === 0) continue;
    expect(verdict.reason === "no-range-or-no-diff").toBe(!verdict.spelled);
  }
  for (const verdict of read.superseded) {
    if (verdict.grammar === 0) continue;
    expect(verdict.reason === "superseded").toBe(verdict.spelled);
  }
});

test.fails("#556.5: the gate refuses a close with no record and admits No diff. and Superseded by #n", () => {
  const read = reading();
  expect(read.markers).toEqual([null, null]);
  expect(read.noDiff).toEqual(["allow", "no-diff"]);
  expect(read.supersededRecord).toEqual(["allow", "superseded"]);
  expect(read.heading).toBe(true);
});
