import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeGh } from "../shared/gh.fake";
import { handoffPath, writeFailure } from "../shared/handoff-path";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import { SLICE_OUTPUT, type Slice } from "../shared/plan-schema";
import type { PublishedIssue } from "../shared/publish-sub-issues";
import { scratchDir } from "../shared/scratch.fixture";
import { checkpointPath } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { seamSweepResponse, seedCheckpoint, sliceResponse, unreachableGh } from "./checkpoint.fixture";
import { runStageCli, stageCliFailure } from "./stage-cli.fixture";
import { runNamedStage } from "./to-tickets";

const DEFAULT_HANDOFF_PATH = ".Workflow/agent-workflows/handoff.txt";

async function loggedByAudit(answer: { notes: string; slices: Slice[] }): Promise<unknown[]> {
  const stage = createFakeStage(JSON.stringify(answer));
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  await runNamedStage("audit-and-publish", "13", stage.exec, createFakeGh().gh);

  return logSpy.mock.calls.map((call) => call[0]);
}

describe("runNamedStage (seam-sweep, against the fake StageExec)", () => {
  it("writes a schema-valid manifest to its checkpoint, with a fake StageExec returning a canned response", async () => {
    withHandoffDir();
    const fake = createFakeStage(seamSweepResponse(["a seam"]));

    const output = await runNamedStage("seam-sweep", "13", fake.exec, unreachableGh);

    expect(output).toEqual(["a seam"]);
    const checkpoint = JSON.parse(readFileSync(checkpointPath("seam-sweep"), "utf8"));
    expect(checkpoint.response).toBe(seamSweepResponse(["a seam"]));
    expect(fake.calls).toHaveLength(1);
  });
});

describe("runNamedStage (slice, against the fake StageExec)", () => {
  function validSlicePlan() {
    return [slice({ title: "One slice" })];
  }

  it("reads the seam-sweep checkpoint as SEAM_MANIFEST and writes a schema- and graph-valid plan to its own checkpoint", async () => {
    withHandoffDir();
    seedCheckpoint("seam-sweep", seamSweepResponse(["a seam"]));
    const plan = validSlicePlan();
    const fake = createFakeStage(sliceResponse(plan));

    const output = await runNamedStage("slice", "13", fake.exec, unreachableGh);

    expect(output).toEqual(plan);
    const checkpoint = JSON.parse(readFileSync(checkpointPath("slice"), "utf8"));
    expect(checkpoint.response).toBe(sliceResponse(plan));
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0][1]).toContain('["a seam"]');
  });

  it("throws naming the offending slice when the plan passes schema but the graph is malformed", async () => {
    withHandoffDir();
    seedCheckpoint("seam-sweep", seamSweepResponse(["a seam"]));
    const badPlan = [slice({ title: "Self-referencing slice", dependsOn: [1] })];
    const fake = createFakeStage(sliceResponse(badPlan));

    await expect(runNamedStage("slice", "13", fake.exec, unreachableGh)).rejects.toThrow(/depends on itself/);
  });
});

describe("runNamedStage (audit-and-publish, against fake StageExec and fake GhExec)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function seedSlicedPlan(): { plan: Slice[] } {
    withHandoffDir();
    const plan = [slice({ title: "Root" })];
    seedCheckpoint("slice", sliceResponse(plan));
    return { plan };
  }

  it("reads the sliced plan as PLAN, publishes the audited plan, and writes it to its own checkpoint", async () => {
    const { plan: slicedPlan } = seedSlicedPlan();
    const auditedPlan = [{ ...slicedPlan[0], title: "Root, re-worded by audit" }];
    const stage = createFakeStage(
      JSON.stringify({ notes: "Granularity: fine as-is.", slices: auditedPlan }),
    );
    const fake = createFakeGh();

    const published = (await runNamedStage(
      "audit-and-publish",
      "13",
      stage.exec,
      fake.gh,
    )) as PublishedIssue[];

    expect(published.map((p) => p.title)).toEqual(["Root, re-worded by audit"]);
    expect(stage.calls).toHaveLength(1);
    expect(stage.calls[0][1]).toContain(JSON.stringify(SLICE_OUTPUT.parse(sliceResponse(slicedPlan))));
    const checkpoint = JSON.parse(readFileSync(checkpointPath("audit-and-publish"), "utf8"));
    expect(JSON.parse(checkpoint.response)).toEqual({
      notes: "Granularity: fine as-is.",
      slices: auditedPlan,
    });

    const createCalls = fake.calls.filter((args) => args[0] === "issue" && args[1] === "create");
    expect(createCalls).toHaveLength(1);
  });

  it("prints the auditor's grading notes and unapplied flags — the `notes` field of its answer — to stdout", async () => {
    const { plan: slicedPlan } = seedSlicedPlan();
    const notes = "Balance: nothing to flag.\nUnapplied flag: left slice 1's title as-is.";

    expect(await loggedByAudit({ notes, slices: slicedPlan })).toContainEqual(notes);
  });

  it("logs only the measurement and success lines — no notes — when the auditor graded silently", async () => {
    const { plan: slicedPlan } = seedSlicedPlan();

    expect(await loggedByAudit({ notes: "", slices: slicedPlan })).toEqual([
      expect.stringMatching(/^audit-and-publish: 1 slice, /),
      "audit-and-publish: published 1 sub-issue under #13",
    ]);
  });

  it("exits nonzero without publishing when the audited plan fails validate-graph.ts", async () => {
    seedSlicedPlan();
    const selfReferencingPlan = [slice({ title: "Self-referencing slice", dependsOn: [1] })];
    const stage = createFakeStage(JSON.stringify({ slices: selfReferencingPlan }));
    const fake = createFakeGh();

    await expect(runNamedStage("audit-and-publish", "13", stage.exec, fake.gh)).rejects.toThrow(
      /depends on itself/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("exits nonzero without publishing when the auditor's response fails schema validation", async () => {
    seedSlicedPlan();
    const stage = createFakeStage(
      JSON.stringify({ slices: [{ title: "Missing everything else" }] }),
    );
    const fake = createFakeGh();

    await expect(runNamedStage("audit-and-publish", "13", stage.exec, fake.gh)).rejects.toThrow(
      /failed schema validation/,
    );
    expect(fake.calls).toHaveLength(0);
  });
});

describe("a plan-emitting stage prints one measurement line against the Slice caps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const criterionOfLength = (length: number) => {
    const marker = " — check: `z`";
    return "z".repeat(length - marker.length) + marker;
  };

  const knownPlan = [
    slice({
      title: "Narrow",
      whatToBuild: "x".repeat(120),
      whyNotMerged: "y".repeat(40),
      acceptanceCriteria: [criterionOfLength(30), criterionOfLength(75)],
      filesClaimed: ["bin/a.ts"],
    }),
    slice({
      title: "Wide",
      whatToBuild: "x".repeat(300),
      whyNotMerged: "y".repeat(90),
      acceptanceCriteria: [criterionOfLength(55)],
      filesClaimed: ["bin/a.ts", "bin/b.ts", "bin/c.ts", "bin/d.ts"],
      dependsOn: [1],
    }),
  ];
  const expectedLine =
    "2 slices, widest filesClaimed 4, longest whatToBuild 300/400, longest whyNotMerged 90/200, longest acceptanceCriteria 75/200";

  it("slice: prints it under the stage's name", async () => {
    withHandoffDir();
    seedCheckpoint("seam-sweep", seamSweepResponse(["a seam"]));
    const fake = createFakeStage(sliceResponse(knownPlan));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runNamedStage("slice", "13", fake.exec, unreachableGh);

    expect(logSpy.mock.calls.map((call) => call[0])).toContain(`slice: ${expectedLine}`);
  });

  it("audit-and-publish: measures the audited plan, not the one it was handed", async () => {
    withHandoffDir();
    seedCheckpoint("slice", sliceResponse([slice({ title: "Before audit" })]));

    expect(await loggedByAudit({ notes: "", slices: knownPlan })).toContain(`audit-and-publish: ${expectedLine}`);
  });
});

describe("handoffPath / writeFailure (FAILURE_REASON_PATH reconciliation)", () => {
  it("writes to FAILURE_REASON_PATH when the environment sets it (the runner's shape)", async () => {
    const dir = withHandoffDir();
    const target = join(dir, "failure_reason.txt");
    process.env.FAILURE_REASON_PATH = target;

    expect(handoffPath()).toBe(target);

    writeFailure("seam-sweep", "boom");

    expect(readFileSync(target, "utf8")).toBe("seam-sweep: boom\n");
  });

  it("falls back to the repo-relative handoff path when FAILURE_REASON_PATH is unset (a local run)", async () => {
    withHandoffDir();
    delete process.env.FAILURE_REASON_PATH;

    const cwd = scratchDir("handoff-cwd");
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      expect(handoffPath()).toBe(DEFAULT_HANDOFF_PATH);

      writeFailure("seam-sweep", "boom");

      expect(readFileSync(join(cwd, DEFAULT_HANDOFF_PATH), "utf8")).toBe("seam-sweep: boom\n");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("stage output moved from the shared handoff to per-stage checkpoints", () => {
  it("readPriorHandoff reads the upstream stage's checkpoint file, not the shared handoff", async () => {
    const dir = withHandoffDir();
    const target = join(dir, "handoff.txt");
    process.env.FAILURE_REASON_PATH = target;
    writeFileSync(target, "not a seam manifest", "utf8");
    seedCheckpoint("seam-sweep", seamSweepResponse(["a real seam"]));
    const plan = [slice({ title: "One slice" })];
    const fake = createFakeStage(sliceResponse(plan));

    const output = await runNamedStage("slice", "13", fake.exec, unreachableGh);

    expect(output).toEqual(plan);
    expect(fake.calls[0][1]).toContain('["a real seam"]');
    expect(fake.calls[0][1]).not.toContain("not a seam manifest");
  });

  it("a successful stage no longer writes its output to handoffPath()", async () => {
    const dir = withHandoffDir();
    const target = join(dir, "handoff.txt");
    process.env.FAILURE_REASON_PATH = target;
    const fake = createFakeStage(seamSweepResponse(["a seam"]));

    await runNamedStage("seam-sweep", "13", fake.exec, unreachableGh);

    expect(existsSync(target)).toBe(false);
  });
});

describe("to-tickets.ts --stage seam-sweep (CLI)", () => {
  it("writes a schema-valid manifest to its checkpoint and exits 0", async () => {
    runStageCli("seam-sweep", { structured: { entries: ["a seam"] } });

    const checkpoint = JSON.parse(readFileSync(checkpointPath("seam-sweep"), "utf8"));
    expect(JSON.parse(checkpoint.response)).toEqual({ entries: ["a seam"] });
  });

  it("writes a failure reason naming the stage and exits nonzero when the run produced no structured output", async () => {
    const reason = stageCliFailure("seam-sweep", "the model just talked, and never called the tool");

    expect(reason).toMatch(/^seam-sweep: .*not valid JSON/);
  });

  it("writes a failure reason naming the stage and exits nonzero when the manifest fails schema validation", async () => {
    const reason = stageCliFailure("seam-sweep", { structured: { entries: ["one line\ntwo lines"] } });

    expect(reason).toMatch(/^seam-sweep: .*failed schema validation/);
  });
});

describe("a refused response is kept where the next reader can find it", () => {
  const rejected = JSON.stringify({ entries: ["one line\ntwo lines"] });

  it("writes the raw response beside the handoff and names that path in the failure", async () => {
    const dir = withHandoffDir();
    process.env.FAILURE_REASON_PATH = join(dir, "handoff.txt");
    const rawPath = join(dir, "seam-sweep-raw-response.txt");
    const fake = createFakeStage(rejected);

    await expect(runNamedStage("seam-sweep", "13", fake.exec, unreachableGh)).rejects.toThrow(rawPath);

    expect(readFileSync(rawPath, "utf8")).toBe(rejected);
  });

  it("keeps the response verbatim, not the schema's account of what was wrong with it", async () => {
    const dir = withHandoffDir();
    process.env.FAILURE_REASON_PATH = join(dir, "handoff.txt");
    const fake = createFakeStage(rejected);

    await expect(runNamedStage("seam-sweep", "13", fake.exec, unreachableGh)).rejects.toThrow();

    expect(readFileSync(join(dir, "seam-sweep-raw-response.txt"), "utf8")).toContain(
      "one line\\ntwo lines",
    );
  });

  it("writes nothing when the stage succeeds, so the file's presence is the signal", async () => {
    const dir = withHandoffDir();
    process.env.FAILURE_REASON_PATH = join(dir, "handoff.txt");
    const fake = createFakeStage(seamSweepResponse(["a seam"]));

    await runNamedStage("seam-sweep", "13", fake.exec, unreachableGh);

    expect(existsSync(join(dir, "seam-sweep-raw-response.txt"))).toBe(false);
  });
});

describe("to-tickets.ts --stage slice (CLI)", () => {
  const validPlan = [slice({ title: "One slice" })];
  const seamSweepCheckpoint = { stage: "seam-sweep", response: seamSweepResponse(["a seam"]) };

  function sliceFailure(plan: Slice[]): string {
    return stageCliFailure("slice", { structured: { slices: plan } }, seamSweepCheckpoint);
  }

  it("writes a schema- and graph-valid plan to its checkpoint and exits 0", async () => {
    runStageCli("slice", { structured: { slices: validPlan } }, seamSweepCheckpoint);

    const checkpoint = JSON.parse(readFileSync(checkpointPath("slice"), "utf8"));
    expect(JSON.parse(checkpoint.response)).toEqual({ slices: validPlan });
  });

  it("writes a failure reason naming the stage and exits nonzero when the plan fails schema validation", () => {
    expect(sliceFailure([slice({ title: "Untestable", acceptanceCriteria: [] })])).toMatch(
      /^slice: .*failed schema validation/,
    );
  });

  it("writes a failure reason naming the stage and exits nonzero when the graph is malformed", () => {
    expect(sliceFailure([slice({ title: "A", dependsOn: [1] })])).toMatch(/^slice: .*depends on itself/);
  });
});
