import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADR_DIR, INDEX_RELATIVE_PATH, regenerateAdrIndex } from "./adr-index";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ADR_CHECK = join(process.env.HOME ?? "", "bin/adr-check");

describe("the in-repo renderer and adr-check", () => {
  it.skipIf(!existsSync(ADR_CHECK))(
    "agree byte for byte over this repo's own corpus, so the writer on a runner cannot stale the gate on the workstation",
    () => {
      const root = mkdtempSync(join(tmpdir(), "adr-parity-"));
      mkdirSync(join(root, ADR_DIR), { recursive: true });
      cpSync(join(REPO_ROOT, ADR_DIR), join(root, ADR_DIR), { recursive: true });
      execFileSync("git", ["init", "-q", root]);

      try {
        execFileSync(ADR_CHECK, ["--fix"], { cwd: root, stdio: "ignore" });
      } catch {
        expect(existsSync(join(root, INDEX_RELATIVE_PATH))).toBe(true);
      }
      const fromChecker = readFileSync(join(root, INDEX_RELATIVE_PATH), "utf8");

      writeFileSync(join(root, INDEX_RELATIVE_PATH), "stale\n");
      expect(regenerateAdrIndex(root)).toBe(true);

      expect(readFileSync(join(root, INDEX_RELATIVE_PATH), "utf8")).toBe(fromChecker);
    },
  );
});

const CLI = ".Workflow/agent-workflows/shared/adr-index.cli.ts";

function runCli(args: string[], targetWorkspace = ""): { status: number | null; stderr: string } {
  const run = spawnSync("npx", ["tsx", CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, TARGET_WORKSPACE: targetWorkspace },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { status: run.status, stderr: run.stderr };
}

describe("the index checker names its root or refuses", () => {
  it("passes over the root it is given", () => {
    expect(runCli(["."]).status).toBe(0);
  });

  it("refuses when nothing named a root, rather than checking whichever directory it was launched from", () => {
    const run = runCli([]);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("no repository root given");
  });

  it("refuses when the argument and TARGET_WORKSPACE name different checkouts", () => {
    const run = runCli(["."], join(REPO_ROOT, ".Workflow"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("roots disagree");
  });

  it("refuses a root that is not there, rather than reporting the absent corpus green", () => {
    const run = runCli([join(tmpdir(), "adr-index-absent-root")]);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("is not a directory");
  });
});
