import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { runRevertDetector } from "./run-revert-detector";

const HEAD = "5f2a1c9d3b7e4086ab19cd52f8306a4e7b1d9c02";

const gitWithoutNotes = ((): string => "") as unknown as GitExec;

async function runAgainstWorkspace(workspace: string): Promise<{ failureText: string; outcome: unknown }> {
  let failureText = "";
  const outcome = await runRevertDetector({
    git: gitWithoutNotes,
    repoDir: workspace,
    head: HEAD,
    log: () => undefined,
  }).catch((err: unknown) => {
    failureText = reason(err);
    return undefined;
  });
  return { failureText, outcome };
}

test("#366.1: run-revert-detector no longer fails on a workspace without eslint.config.js", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "run-revert-detector-"));

  const { failureText, outcome } = await runAgainstWorkspace(workspace);

  expect(failureText).not.toContain("eslint.config.js");
  expect(outcome).toEqual({ declinedCount: 0 });
});

test("run-revert-detector no longer fails when eslint.config.js exists but cannot be imported", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "run-revert-detector-"));
  writeFileSync(
    join(workspace, "eslint.config.js"),
    'import "totally-not-a-real-package-xyz";\nexport default [];\n',
  );

  const { failureText, outcome } = await runAgainstWorkspace(workspace);

  expect(failureText).toBe("");
  expect(outcome).toEqual({ declinedCount: 0 });
});
