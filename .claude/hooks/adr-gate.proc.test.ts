import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const HOOK_DIR = fileURLToPath(new URL(".", import.meta.url));
const HOOK_FILE = fileURLToPath(new URL("adr-gate.py", import.meta.url));
const SHAPE_DIR = fileURLToPath(new URL("../../bin/", import.meta.url));

const GATE_PROBE = `
import importlib.machinery, importlib.util, json, sys, tempfile
from pathlib import Path

hooks, shape_dir, gate_file = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, hooks)
sys.path.insert(0, shape_dir)
import adr_shape

loader = importlib.machinery.SourceFileLoader("adr_gate", gate_file)
gate = importlib.util.module_from_spec(importlib.util.spec_from_loader("adr_gate", loader))
loader.exec_module(gate)

own_landed = gate.__dict__.get("LANDED_RE")
own_index = gate.__dict__.get("INDEX_NAME")

root = Path(tempfile.mkdtemp())
(root / ".git").write_text("")
corpus = root / "docs" / "adr"
corpus.mkdir(parents=True)

print(json.dumps({
    "landedShared": own_landed is None or own_landed is adr_shape.LANDED_RE,
    "indexShared": own_index is None or own_index is adr_shape.INDEX_NAME,
    "indexGuard": gate.check(str(corpus / adr_shape.INDEX_NAME))[0],
    "handNumberedGuard": gate.check(str(corpus / "0999-a-ruling-typed-by-hand.md"))[0],
}))
`;

interface GateProbe {
  landedShared: boolean;
  indexShared: boolean;
  indexGuard: string;
  handNumberedGuard: string;
}

test.fails(
  "#553.3: .claude/hooks/adr-gate.py reads adr_shape's LANDED_RE and INDEX_NAME instead of re-declaring its own",
  () => {
    const run = spawnSync("python3", ["-c", GATE_PROBE, HOOK_DIR, SHAPE_DIR, HOOK_FILE], {
      cwd: HOOK_DIR,
      encoding: "utf8",
      timeout: 120000,
    });

    expect(run.status).toBe(0);

    const gate = JSON.parse(run.stdout ?? "") as GateProbe;

    expect(gate.landedShared).toBe(true);
    expect(gate.indexShared).toBe(true);
    expect(gate.indexGuard).toBe("generated-index");
    expect(gate.handNumberedGuard).toBe("hand-numbered");
  },
  180000,
);
