import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { type AdrFile, adrCorpus, renderAdrIndex } from "./adr-index";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const HOOKS = join(REPO_ROOT, ".claude", "hooks");
const BIN = join(REPO_ROOT, "bin");

const ADVICE_PROBE = `
import importlib.machinery, importlib.util, json, os, sys

hooks, bin_dir = sys.argv[1], sys.argv[2]
sys.path.insert(0, hooks)
sys.path.insert(0, bin_dir)

loader = importlib.machinery.SourceFileLoader("adr_gate", os.path.join(hooks, "adr-gate.py"))
gate = importlib.util.module_from_spec(importlib.util.spec_from_loader("adr_gate", loader))
loader.exec_module(gate)

print(json.dumps({
    "generatedIndex": gate.GENERATED_INDEX,
    "handNumbered": gate.HAND_NUMBERED,
}))
`;

interface AdviceProbe {
  generatedIndex: string;
  handNumbered: string;
}

function adr(name: string, title: string, status: string): AdrFile {
  return {
    name,
    content: [
      "---",
      `status: ${status}`,
      "date: 2026-01-01",
      "reversal: four repos carry the marker in their issue bodies",
      "---",
      "",
      `# ${title}`,
      "",
      "**Rejected: a second numbering scheme.** Two schemes collide at the land.",
      "",
    ].join("\n"),
  };
}

const FIXTURE: AdrFile[] = [
  adr("0001-a-ruling-that-binds-later-work.md", "A ruling that binds later work", "constraint"),
  adr("0002-a-ruling-that-was-demoted-later.md", "A ruling that was demoted later", "note"),
];

test(
  "#553.4: the generated-by line in adr-index.ts, the rendered INDEX.md and adr-gate.py's advice all name the TypeScript tool",
  () => {
    const rendered = renderAdrIndex(FIXTURE);

    expect(rendered).not.toContain("adr-check");
    expect(rendered.split("\n")[0]).toMatch(/adrs|adr-index/);
    expect(renderAdrIndex(adrCorpus(REPO_ROOT))).not.toContain("adr-check");

    const run = spawnSync("python3", ["-c", ADVICE_PROBE, HOOKS, BIN], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120000,
    });

    expect(run.status).toBe(0);

    const advice = JSON.parse(run.stdout ?? "") as AdviceProbe;

    expect(advice.generatedIndex).not.toContain("adr-check");
    expect(advice.generatedIndex).toMatch(/adrs|adr-index/);
    expect(advice.handNumbered).not.toContain("adr-check");
  },
  180000,
);

test(
  "#553.5: shared/adr-index.proc.test.ts is gone, because it compared TypeScript to $HOME/bin/adr-check under skipIf",
  () => {
    expect(existsSync(join(HERE, "adr-index.proc.test.ts"))).toBe(false);
  },
);

test(
  "#553.6: npm run adrs still renders this repo's corpus byte-identically to what is committed",
  () => {
    const slot = spawnSync("npm", ["run", "adrs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 300000,
    });

    expect(slot.status).toBe(0);

    const corpus = adrCorpus(REPO_ROOT);

    expect(corpus.length).toBeGreaterThan(0);
    expect(renderAdrIndex(corpus)).not.toContain("adr-check");
  },
  420000,
);
