import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LABELS_DOC_RELATIVE_PATH, labelsDocIsCurrent } from "./labels-doc.cli";
import { LABELS_TABLE_CLOSE, LABELS_TABLE_OPEN } from "./labels";
import { scratchDir } from "./scratch.fixture";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CLI = join(REPO_ROOT, ".Workflow/agent-workflows/shared/labels-doc.cli.ts");

function runCli(root: string, ...flags: string[]): { status: number | null; stderr: string; stdout: string } {
  const run = spawnSync("npx", ["tsx", CLI, root, ...flags], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

function staleRepo(): string {
  const root = scratchDir("labels-doc");
  mkdirSync(join(root, "docs/agents"), { recursive: true });
  writeFileSync(join(root, LABELS_DOC_RELATIVE_PATH), `# Labels\n\n${LABELS_TABLE_OPEN}\nstale\n${LABELS_TABLE_CLOSE}\n`);
  return root;
}

describe("docs/agents/pipeline-labels.md is generated from the catalogue", () => {
  it("is current in this repository, so the table can never drift from shared/labels.ts", () => {
    expect(labelsDocIsCurrent(REPO_ROOT)).toBe(true);
  });

  it("npm run labels-doc -- --check fails on a stale doc and names the fix", () => {
    const root = staleRepo();

    const check = runCli(root, "--check");

    expect(check.status).toBe(1);
    expect(check.stderr).toContain("npm run labels-doc");
  });

  it("npm run labels-doc rewrites the table between the markers and leaves the prose around it", () => {
    const root = staleRepo();

    const fix = runCli(root);
    const after = readFileSync(join(root, LABELS_DOC_RELATIVE_PATH), "utf8");

    expect(fix.status).toBe(0);
    expect(after.startsWith("# Labels\n\n")).toBe(true);
    expect(after).toContain("| `5-building` |");
    expect(after).not.toContain("\nstale\n");
    expect(runCli(root, "--check").status).toBe(0);
  });
});
