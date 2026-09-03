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
 * @fixture Reached only from the suites, by design. `to-tickets.test.ts` carried these until
 * `vocabulary.test.ts` and `ticket-format.test.ts` needed the same seeding to render a prompt
 * through the real stage instead of reading the prompt file (#360).
 */

export const unreachableGh: GhExec = (args) => {
  throw new Error(`gh should not have been called: ${JSON.stringify(args)}`);
};

export function seedCheckpoint(stage: string, response: string): void {
  const path = checkpointPath(stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ key: "test", response }), "utf8");
}

export function seamSweepResponse(entries: string[]): string {
  return JSON.stringify({ entries });
}

export function sliceResponse(plan: Slice[]): string {
  return JSON.stringify({ slices: plan });
}

const VALID_ANSWER: Record<StageName, string> = {
  "seam-sweep": seamSweepResponse(["a seam"]),
  slice: sliceResponse([slice({ title: "One slice" })]),
  "audit-and-publish": JSON.stringify({ notes: "", slices: [slice({ title: "One slice" })] }),
};

export async function promptHandedTo(stage: StageName): Promise<string> {
  withHandoffDir();
  seedCheckpoint("seam-sweep", seamSweepResponse(["a seam"]));
  seedCheckpoint("slice", sliceResponse([slice({ title: "One slice" })]));
  const fake = createFakeStage(VALID_ANSWER[stage]);

  await runNamedStage(stage, "13", fake.exec, createFakeGh().gh);

  return fake.calls[0][1];
}
