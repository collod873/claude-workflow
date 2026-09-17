import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import type { Slice } from "../shared/plan-schema";
import type { PublishedIssue } from "../shared/publish-sub-issues";
import { checkpointPath, type StageExec, type StageReply } from "../shared/stage";
import { createFakeStage, createFakeStages } from "../shared/stage.fake";
import { trackerMemory } from "../shared/tracker-memory";
import { runNamedStage } from "./to-tickets";

const SESSION = "session-that-wrote-the-plan";

const unreachableGh = trackerMemory() as unknown as GhExec;

function sliceResponse(plan: Slice[]): string {
  return JSON.stringify({ slices: plan });
}

const selfDependent = [slice({ title: "Leans on itself", dependsOn: [1] })];
const outOfRange = [slice({ title: "Leans on nothing", dependsOn: [9] })];
const repaired = [slice({ title: "Stands alone" })];

function inSession(response: string): StageReply {
  return { text: response, sessionId: SESSION };
}

function auditResponse(plan: Slice[]): string {
  return JSON.stringify({ notes: "", slices: plan });
}

function seededForSlice(): void {
  withHandoffDir();
  const seamSweepCheckpoint = checkpointPath("seam-sweep");
  mkdirSync(dirname(seamSweepCheckpoint), { recursive: true });
  writeFileSync(seamSweepCheckpoint, JSON.stringify({ key: "test", response: JSON.stringify({ entries: ["a seam"] }) }), "utf8");
}

function seededForAudit(): void {
  withHandoffDir();
  const sliceCheckpoint = checkpointPath("slice");
  mkdirSync(dirname(sliceCheckpoint), { recursive: true });
  writeFileSync(sliceCheckpoint, JSON.stringify({ key: "test", response: sliceResponse(repaired) }), "utf8");
}

function issueCreates(calls: string[][]): string[][] {
  return calls.filter((args) => args[0] === "issue" && args[1] === "create");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a refused answer goes back to the session that wrote it", () => {
  test("the slice stage resumes its refused session once with the refusal and returns the repaired plan", async () => {
    seededForSlice();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stage = createFakeStages([inSession(sliceResponse(selfDependent)), sliceResponse(repaired)]);

    const output = await runNamedStage("slice", "13", stage.exec, unreachableGh);

    expect(output).toEqual(repaired);
    expect(stage.calls).toHaveLength(2);
    expect(stage.calls[1]).toEqual(expect.arrayContaining(["--resume", SESSION]));
    expect(stage.calls[1][1]).toContain("depends on itself");
    expect(JSON.parse(readFileSync(checkpointPath("slice"), "utf8")).response).toBe(sliceResponse(repaired));
  });

  test("audit-and-publish resumes its refused session once and publishes the repaired plan, writing no issue before it passes", async () => {
    seededForAudit();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fake = createFakeGh();
    const createsWhenResumed: number[] = [];
    const answers = createFakeStages([inSession(auditResponse(selfDependent)), auditResponse(repaired)]);
    const exec: StageExec = (argv, stdin, signal) => {
      if (argv.includes("--resume")) createsWhenResumed.push(issueCreates(fake.calls).length);
      return answers.exec(argv, stdin, signal);
    };
    const gh: GhExec = (args) => (args[0] === "issue" && args[1] === "edit" ? "" : fake.gh(args));

    const published = (await runNamedStage("audit-and-publish", "13", exec, gh)) as PublishedIssue[];

    expect(createsWhenResumed).toEqual([0]);
    expect(published.map((issue) => issue.title)).toEqual(["Stands alone"]);
    expect(issueCreates(fake.calls)).toHaveLength(1);
  });

  test("an answer refused twice fails the stage naming the second refusal, with no third session", async () => {
    seededForSlice();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stage = createFakeStages([
      inSession(sliceResponse(selfDependent)),
      inSession(sliceResponse(outOfRange)),
      sliceResponse(repaired),
    ]);

    await expect(runNamedStage("slice", "13", stage.exec, unreachableGh)).rejects.toThrow(/out-of-range dependsOn/);
    expect(stage.calls).toHaveLength(2);
  });
});

describe("what the plan gate judges", () => {
  test("the slice stage roots a repairable claim instead of refusing it", async () => {
    seededForSlice();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const plan = [slice({ title: "Claims it short", filesClaimed: ["agent-workflows/to-tickets/to-tickets.ts"] })];
    const stage = createFakeStage(sliceResponse(plan));

    await expect(runNamedStage("slice", "13", stage.exec, unreachableGh)).resolves.toBeDefined();
    expect(stage.calls).toHaveLength(1);
  });

  test("one refusal names every failing check, not only the first", async () => {
    seededForSlice();
    const plan = [slice({ title: "Wrong twice", dependsOn: [1], filesClaimed: ["vitest.config.ts"] })];
    const stage = createFakeStage(sliceResponse(plan));

    await expect(runNamedStage("slice", "13", stage.exec, unreachableGh)).rejects.toThrow(
      /depends on itself[\s\S]*no pull request may touch/,
    );
  });
});
