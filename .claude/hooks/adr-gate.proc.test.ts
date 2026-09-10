import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const hooks = fileURLToPath(new URL(".", import.meta.url));
const gate = fileURLToPath(new URL("adr-gate.py", import.meta.url));

const PROBE = [
  "import importlib.machinery, importlib.util, json, sys",
  "sys.path.insert(0, sys.argv[1])",
  'loader = importlib.machinery.SourceFileLoader("adr_gate", sys.argv[2])',
  'module = importlib.util.module_from_spec(importlib.util.spec_from_loader("adr_gate", loader))',
  "loader.exec_module(module)",
  "print(json.dumps(list(module.check(sys.argv[3]))))",
].join("\n");

function guarded(target: string): [string, string] {
  const asked = spawnSync("python3", ["-c", PROBE, hooks, gate, target], { encoding: "utf8" });
  expect(asked.status).toBe(0);
  return JSON.parse(asked.stdout) as [string, string];
}

test.fails(
  "#412.3: adr-gate.py refuses a hand-numbered write in any corpus, not only the root, and still allows a landed-shape write under a feature corpus",
  () => {
    const repo = mkdtempSync(join(tmpdir(), "adr-gate-412-"));
    mkdirSync(join(repo, ".git"), { recursive: true });
    const rootCorpus = join(repo, "docs", "adr");
    const featureCorpus = join(repo, "src", "features", "crm", "docs", "adr");
    mkdirSync(rootCorpus, { recursive: true });
    mkdirSync(featureCorpus, { recursive: true });
    const standing = join(featureCorpus, "0042-a-feature-ruling-that-binds-later-work.md");
    writeFileSync(standing, "# A feature ruling that binds later work\n");

    const [featureGuard, featureReason] = guarded(join(featureCorpus, "0091-a-new-ruling.md"));
    expect(featureGuard).toBe("hand-numbered");
    expect(featureReason).toContain("new-adr");
    expect(featureReason).toContain("--land");

    const [rootGuard] = guarded(join(rootCorpus, "0034-a-new-ruling.md"));
    expect(rootGuard).toBe("hand-numbered");

    expect(guarded(standing)).toEqual(["", ""]);
    expect(guarded(join(featureCorpus, "draft-a-new-ruling.md"))).toEqual(["", ""]);
  },
  60_000,
);
