import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { stubClaudeCli, type StubAnswer } from "../shared/claude-cli.stub";
import { withHandoffDir } from "../shared/handoff-dir.fixture";

export const TO_TICKETS_PATH = ".Workflow/agent-workflows/to-tickets/to-tickets.ts";

interface StageRun {
  handoffFile: string;
}

function spawnStage(stage: string, answer: StubAnswer, priorCheckpoint?: { stage: string; response: string }) {
  const dir = withHandoffDir();
  const { env, handoffFile } = stubClaudeCli(dir, answer, priorCheckpoint);
  const run = () =>
    execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", stage, "--issue", "13"], {
      env,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  return { run, handoffFile };
}

/**
 * @fixture Reached only from the suite, by design.
 */
export function runStageCli(
  stage: string,
  answer: StubAnswer,
  priorCheckpoint?: { stage: string; response: string },
): StageRun {
  const { run, handoffFile } = spawnStage(stage, answer, priorCheckpoint);
  run();
  return { handoffFile };
}

/**
 * @fixture Reached only from the suite, by design.
 */
export function stageCliFailure(
  stage: string,
  answer: StubAnswer,
  priorCheckpoint?: { stage: string; response: string },
): string {
  const { run, handoffFile } = spawnStage(stage, answer, priorCheckpoint);
  expect(run).toThrow();
  return readFileSync(handoffFile, "utf8");
}
