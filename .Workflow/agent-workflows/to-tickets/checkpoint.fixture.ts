import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import type { Slice } from "../shared/plan-schema";
import { checkpointPath } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { runNamedStage, type StageName } from "./to-tickets";

/**
 * The checkpoints a to-tickets stage reads before it runs, seeded directly — and one run of any
 * stage over them, for a test that is about the prompt the stage was handed rather than what it
 * did with the answer.
 *
 * @fixture Reached only from the suites, by design. `to-tickets.test.ts` carried these until
 * `vocabulary.test.ts` and `ticket-format.test.ts` needed the same seeding to render a prompt
 * through the real stage instead of reading the prompt file (#360).
 */

/**
 * A `GhExec` for a stage that must never touch GitHub — seam-sweep and slice take one only because
 * `runNamedStage`'s dispatch is uniform across every stage; asserting neither calls it is worth
 * more than a silent fake.
 */
export const unreachableGh: GhExec = (args) => {
  throw new Error(`gh should not have been called: ${JSON.stringify(args)}`);
};

/**
 * Seeds `stage`'s checkpoint file directly, in the wire-format shape a real `runStage` call would
 * have written it in (see `../shared/stage.ts`'s `writeCheckpoint`) — the key is a placeholder,
 * since `readPriorHandoff` (the only reader these tests exercise indirectly) never checks it; only
 * `runStage`'s own cache-hit path does, against a commit these tests don't control.
 */
export function seedCheckpoint(stage: string, response: string): void {
  const path = checkpointPath(stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ key: "test", response }), "utf8");
}

/** The wire-format text a seam-sweep checkpoint holds for the given entries. */
export function seamSweepResponse(entries: string[]): string {
  return JSON.stringify({ entries });
}

/** The wire-format text a slice checkpoint holds for the given plan. */
export function sliceResponse(plan: Slice[]): string {
  return JSON.stringify({ slices: plan });
}

/** An answer each stage's schema accepts, so a run that is about the prompt never dies on the reply. */
const VALID_ANSWER: Record<StageName, string> = {
  "seam-sweep": seamSweepResponse(["a seam"]),
  slice: sliceResponse([slice({ title: "One slice" })]),
  "audit-and-publish": JSON.stringify({ notes: "", slices: [slice({ title: "One slice" })] }),
};

/**
 * The prompt `stage` handed its model, with every upstream checkpoint it reads already seeded —
 * rendered through `runNamedStage` and the real prompt file, which is the only way to see what a
 * stage's `{{VAR}}`s were substituted with.
 */
export async function promptHandedTo(stage: StageName): Promise<string> {
  withHandoffDir();
  seedCheckpoint("seam-sweep", seamSweepResponse(["a seam"]));
  seedCheckpoint("slice", sliceResponse([slice({ title: "One slice" })]));
  const fake = createFakeStage(VALID_ANSWER[stage]);

  await runNamedStage(stage, "13", fake.exec, createFakeGh().gh);

  return fake.calls[0][1];
}
