import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { stubClaudeCli, type StubAnswer } from "../shared/claude-cli.stub";
import { withHandoffDir } from "../shared/handoff-dir.fixture";

/** The entrypoint these runs spawn, repo-relative — the same path `to-tickets.yml` names. */
export const TO_TICKETS_PATH = ".Workflow/agent-workflows/to-tickets/to-tickets.ts";

/**
 * A stage's real CLI, `--stage <stage> --issue 13`, run end to end against a stub `claude`
 * answering `answer` — proving the wiring (argv, extraction, schema, checkpoint write, exit code)
 * without launching a model. `priorCheckpoint` seeds the upstream stage's checkpoint first, for a
 * stage (like `slice`) that reads one as its own input.
 *
 * The spawn lives here rather than in the suite because a `*.test.ts` may not import
 * `node:child_process` (#360): a test that spawns is a test whose failure could be the runner's
 * rather than the subject's, so the spawning is kept to one place the suite can name.
 */
interface StageRun {
  /** Where the stage wrote its failure reason, if it wrote one. */
  handoffFile: string;
}

function spawnStage(stage: string, answer: StubAnswer, priorCheckpoint?: { stage: string; response: string }) {
  const dir = withHandoffDir();
  const { env, handoffFile } = stubClaudeCli(dir, answer, priorCheckpoint);
  const run = () =>
    execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", stage, "--issue", "13"], {
      env,
      encoding: "utf8",
    });
  return { run, handoffFile };
}

/**
 * Runs the stage and expects it to exit 0 — a nonzero exit throws, as `execFileSync` does.
 *
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
 * Runs the stage, asserts it exits nonzero, and hands back the failure reason it wrote to the
 * handoff — the thing every refusal test is about.
 *
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
