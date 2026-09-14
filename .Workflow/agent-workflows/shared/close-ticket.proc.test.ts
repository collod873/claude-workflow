import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { retirementBody as deadLaneRetirementBody, type RunSummary } from "../watchdog/dead-lanes";
import { retirementBody as unreachableRetirementBody } from "./unreachable";

interface WrittenRecord {
  writer: string;
  ok: boolean;
  criteria: number | null;
  text: string | null;
}

interface WriterReading {
  heading: string;
  noDiff: string;
  records: WrittenRecord[];
}

interface GateVerdict {
  outcome: string;
  reason: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

const ROOT = resolve(HERE, "..", "..", "..");

const HOOKS = join(ROOT, ".claude", "hooks");

const RULES = join(HERE, "closing-record.rules.json");

const RESTARTED_LANE = ".github/workflows/watchdog-caller.yml";

const WRITER = `
import importlib.machinery
import importlib.util
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
rules = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
loader = importlib.machinery.SourceFileLoader("close_ticket_under_test", str(root / "bin" / "close-ticket"))
spec = importlib.util.spec_from_loader("close_ticket_under_test", loader)
closer = importlib.util.module_from_spec(spec)
loader.exec_module(closer)

criterion = "- [ ] a criterion - check: \`true\`"
no_diff, no_diff_ok = closer.render_record("HEAD..HEAD", None, str(root))
checked, checked_ok = closer.render_record("HEAD~1..HEAD", [criterion], str(root))
superseded, error = closer.render_superseded_record(4242, [criterion], [("MOVED", "#4242 criterion 1")])

print(json.dumps({
    "heading": rules["heading"],
    "noDiff": rules["noDiff"],
    "records": [
        {"writer": "bin/close-ticket no-diff", "ok": bool(no_diff_ok), "criteria": None, "text": no_diff},
        {"writer": "bin/close-ticket range", "ok": bool(checked_ok), "criteria": 1, "text": checked},
        {"writer": "bin/close-ticket superseded", "ok": error is None, "criteria": 1, "text": superseded},
    ],
}))
`;

const GATE = `
import importlib.util
import json
import sys
from pathlib import Path

hooks = Path(sys.argv[1])
sys.path.insert(0, str(hooks))
spec = importlib.util.spec_from_file_location("close_gate_under_test", str(hooks / "close-gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

verdicts = []
for case in json.loads(sys.argv[2])["records"]:
    marker = gate.find_marker_text(case["text"])
    if marker is None:
        verdicts.append({"outcome": "deny", "reason": "no-closing-record"})
        continue
    outcome, why, _ = gate.evaluate_record(marker, case["criteria"])
    verdicts.append({"outcome": outcome, "reason": why})
print(json.dumps(verdicts))
`;

function python(script: string, args: string[]): string {
  return execFileSync("python3", ["-c", script, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function restartedRun(): RunSummary {
  return {
    id: 91,
    name: "watchdog",
    path: RESTARTED_LANE,
    status: "completed",
    conclusion: "success",
    htmlUrl: "https://example.invalid/actions/runs/91",
    headBranch: "trunk",
    createdAt: "2026-03-04T05:06:07Z",
  };
}

function writerReading(): WriterReading {
  return JSON.parse(python(WRITER, [ROOT, RULES])) as WriterReading;
}

function admitted(records: Array<{ text: string; criteria: number | null }>): GateVerdict[] {
  return JSON.parse(python(GATE, [HOOKS, JSON.stringify({ records })])) as GateVerdict[];
}

test.fails("#556.4: every record either writer produces is one the gate admits", () => {
  const source = writerReading();
  const restarted = deadLaneRetirementBody(RESTARTED_LANE, restartedRun());
  const all: WrittenRecord[] = [
    ...source.records,
    { writer: "unreachable.ts", ok: true, criteria: null, text: unreachableRetirementBody() },
    { writer: "dead-lanes.ts", ok: true, criteria: null, text: restarted },
  ];
  expect(all.length).toBeGreaterThanOrEqual(5);
  const verdicts = admitted(all.map((record) => ({ text: record.text ?? "", criteria: record.criteria })));
  expect(verdicts.length).toBe(all.length);
  all.forEach((record, index) => {
    expect(record.ok).toBe(true);
    expect(record.text).not.toBeNull();
    const text = record.text ?? "";
    expect(text.startsWith(source.heading)).toBe(true);
    if (record.criteria === null) expect(text).toContain(source.noDiff);
    expect(verdicts[index].outcome).toBe("allow");
  });
});
