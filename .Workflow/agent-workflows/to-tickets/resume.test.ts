import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import type { PublishedIssue } from "../shared/publish-sub-issues";
import type { StageExec } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { runNamedStage } from "./to-tickets";

describe("a retry after audit-and-publish alone failed", () => {
  it("spawns a model only for audit-and-publish, reading seam-sweep and slice back from checkpoints", async () => {
    withHandoffDir();

    const unreachableGh: GhExec = (args) => {
      throw new Error(`gh should not have been called: ${JSON.stringify(args)}`);
    };
    const seamManifest = ["a seam"];
    const plan = [slice({ title: "Root" })];

    const firstSeamSweep = createFakeStage(JSON.stringify({ entries: seamManifest }));
    const firstSlice = createFakeStage(JSON.stringify({ slices: plan }));
    const failingAudit: StageExec = async () => "the model just talked, and never called the tool";

    const firstSeamSweepOutput = await runNamedStage("seam-sweep", "13", firstSeamSweep.exec, unreachableGh);
    const firstSliceOutput = await runNamedStage("slice", "13", firstSlice.exec, unreachableGh);
    expect(firstSeamSweepOutput).toEqual(seamManifest);
    expect(firstSliceOutput).toEqual(plan);

    await expect(runNamedStage("audit-and-publish", "13", failingAudit, unreachableGh)).rejects.toThrow();

    const unreachableExec: StageExec = async () => {
      throw new Error("StageExec should not have been called — this stage's checkpoint should have been reused");
    };

    const retriedSeamSweepOutput = await runNamedStage("seam-sweep", "13", unreachableExec, unreachableGh);
    const retriedSliceOutput = await runNamedStage("slice", "13", unreachableExec, unreachableGh);
    expect(retriedSeamSweepOutput).toEqual(seamManifest);
    expect(retriedSliceOutput).toEqual(plan);

    const auditedPlan = [{ ...plan[0], title: "Root, re-worded by audit" }];
    const succeedingAudit = createFakeStage(JSON.stringify({ notes: "", slices: auditedPlan }));
    const tracker = createFakeGh();

    const published = (await runNamedStage(
      "audit-and-publish",
      "13",
      succeedingAudit.exec,
      tracker.gh,
    )) as PublishedIssue[];

    expect(succeedingAudit.calls).toHaveLength(1);
    expect(published.map((p) => p.title)).toEqual(["Root, re-worded by audit"]);
  });
});
