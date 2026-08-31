import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import type { PublishedIssue } from "../shared/publish-sub-issues";
import type { StageExec } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { runNamedStage } from "./to-tickets";

/**
 * `to-tickets.yml` re-runs the whole job on a retry — a failed workflow run,
 * re-dispatched against the same commit, invokes `--stage seam-sweep`,
 * `--stage slice` and `--stage audit-and-publish` again, in order, exactly
 * as the first attempt did. Without checkpointing, that means paying for two
 * model calls the first attempt already answered correctly, just to reach
 * the one stage that actually needs to run again.
 *
 * This exercises that retry end to end, through `runNamedStage` rather than
 * the CLI — the checkpointing this pins lives in `runStage`
 * (`../shared/stage.ts`), and `runNamedStage` is the same seam
 * `to-tickets.ts`'s `--stage` dispatch goes through, so nothing about
 * spawning a real `npx tsx` process is needed to observe it.
 */
describe("a retry after audit-and-publish alone failed", () => {
  it("spawns a model only for audit-and-publish, reading seam-sweep and slice back from checkpoints", async () => {
    withHandoffDir();

    const unreachableGh: GhExec = (args) => {
      throw new Error(`gh should not have been called: ${JSON.stringify(args)}`);
    };
    const seamManifest = ["a seam"];
    const plan = [slice({ title: "Root" })];

    // First attempt: seam-sweep and slice both succeed (and checkpoint);
    // audit-and-publish's model answers with no structured output at all —
    // the shape a run dies on when the tool call never lands.
    const firstSeamSweep = createFakeStage(JSON.stringify({ entries: seamManifest }));
    const firstSlice = createFakeStage(JSON.stringify({ slices: plan }));
    const failingAudit: StageExec = async () => "the model just talked, and never called the tool";

    const firstSeamSweepOutput = await runNamedStage("seam-sweep", "13", firstSeamSweep.exec, unreachableGh);
    const firstSliceOutput = await runNamedStage("slice", "13", firstSlice.exec, unreachableGh);
    expect(firstSeamSweepOutput).toEqual(seamManifest);
    expect(firstSliceOutput).toEqual(plan);

    await expect(runNamedStage("audit-and-publish", "13", failingAudit, unreachableGh)).rejects.toThrow();

    // Retry: the job re-runs from scratch, against the same commit, with the
    // same issue number and the same seam-sweep/slice prompts (nothing about
    // the repo or the input changed between attempts) — so both checkpoints
    // from the first attempt still match, and a StageExec that throws if
    // called proves neither stage spawns a model this time.
    const unreachableExec: StageExec = async () => {
      throw new Error("StageExec should not have been called — this stage's checkpoint should have been reused");
    };

    const retriedSeamSweepOutput = await runNamedStage("seam-sweep", "13", unreachableExec, unreachableGh);
    const retriedSliceOutput = await runNamedStage("slice", "13", unreachableExec, unreachableGh);
    expect(retriedSeamSweepOutput).toEqual(seamManifest);
    expect(retriedSliceOutput).toEqual(plan);

    const auditedPlan = [{ ...plan[0], title: "Root, re-worded by audit" }];
    const succeedingAudit = createFakeStage(JSON.stringify({ notes: "", slices: auditedPlan }));
    const fakeGh = createFakeGh();

    const published = (await runNamedStage(
      "audit-and-publish",
      "13",
      succeedingAudit.exec,
      fakeGh.gh,
    )) as PublishedIssue[];

    expect(succeedingAudit.calls).toHaveLength(1);
    expect(published.map((p) => p.title)).toEqual(["Root, re-worded by audit"]);
  });
});
