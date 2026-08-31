import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { handoffPath, writeFailure } from "../shared/handoff-path";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { stubClaudeCli } from "../shared/claude-cli.stub";
import { isolateCheckpointsPerTest } from "../shared/isolate-checkpoints.setup";
import { slice } from "../shared/plan.fixture";
import { SLICE_OUTPUT, type Slice } from "../shared/plan-schema";
import type { PublishedIssue } from "../shared/publish-sub-issues";
import { checkpointPath } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { runNamedStage } from "./to-tickets";

const TO_TICKETS_PATH = ".Workflow/agent-workflows/to-tickets/to-tickets.ts";
const DEFAULT_HANDOFF_PATH = ".Workflow/agent-workflows/handoff.txt";

/** A `GhExec` for a stage that must never touch GitHub — seam-sweep and
 * slice take one only because `runNamedStage`'s dispatch is uniform across
 * every stage; asserting neither calls it is worth more than a silent fake. */
const unreachableGh: GhExec = (args) => {
  throw new Error(`gh should not have been called: ${JSON.stringify(args)}`);
};

// Every test in this file uses the same `--issue 13`, and most exercise the
// same three stage prompts — without a fresh CHECKPOINTS_DIR per test, two
// tests could compute the same checkpoint key and the second would silently
// reuse the first's answer. See `isolateCheckpointsPerTest`'s own comment.
beforeEach(() => {
  isolateCheckpointsPerTest();
});

/**
 * Seeds `stage`'s checkpoint file directly, in the wire-format shape a real
 * `runStage` call would have written it in (see `../shared/stage.ts`'s
 * `writeCheckpoint`) — the key is a placeholder, since `readPriorHandoff`
 * (the only reader these tests exercise indirectly) never checks it; only
 * `runStage`'s own cache-hit path does, against a commit these tests don't
 * control.
 */
function seedCheckpoint(stage: string, response: string): void {
  const path = checkpointPath(stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ key: "test", response }), "utf8");
}

/** The wire-format text a seam-sweep checkpoint holds for the given entries. */
function seamSweepResponse(entries: string[]): string {
  return JSON.stringify({ entries });
}

/** The wire-format text a slice checkpoint holds for the given plan. */
function sliceResponse(plan: Slice[]): string {
  return JSON.stringify({ slices: plan });
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
    const fakeStage = createFakeStage(
      JSON.stringify({ notes: "Granularity: fine as-is.", slices: auditedPlan }),
    );
    const fakeGh = createFakeGh();

    const published = (await runNamedStage(
      "audit-and-publish",
      "13",
      fakeStage.exec,
      fakeGh.gh,
    )) as PublishedIssue[];

    expect(published.map((p) => p.title)).toEqual(["Root, re-worded by audit"]);
    expect(fakeStage.calls).toHaveLength(1);
    // Not `JSON.stringify(slicedPlan)` — `readPriorHandoff` unwraps the
    // checkpoint through `SLICE_OUTPUT.parse`, which re-serialises to zod's
    // own field order rather than the fixture's, so the expected text has to
    // go through the same unwrap to match.
    expect(fakeStage.calls[0][1]).toContain(JSON.stringify(SLICE_OUTPUT.parse(sliceResponse(slicedPlan))));
    const checkpoint = JSON.parse(readFileSync(checkpointPath("audit-and-publish"), "utf8"));
    expect(JSON.parse(checkpoint.response)).toEqual({
      notes: "Granularity: fine as-is.",
      slices: auditedPlan,
    });

    const createCalls = fakeGh.calls.filter((args) => args[0] === "issue" && args[1] === "create");
    expect(createCalls).toHaveLength(1);
  });

  it("prints the auditor's grading notes and unapplied flags — the `notes` field of its answer — to stdout", async () => {
    const { plan: slicedPlan } = seedSlicedPlan();
    const notes = "Balance: nothing to flag.\nUnapplied flag: left slice 1's title as-is.";
    const fakeStage = createFakeStage(JSON.stringify({ notes, slices: slicedPlan }));
    const fakeGh = createFakeGh();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runNamedStage("audit-and-publish", "13", fakeStage.exec, fakeGh.gh);

    expect(logSpy.mock.calls.map((call) => call[0])).toContainEqual(notes);
  });

  it("logs only the measurement and success lines — no notes — when the auditor graded silently", async () => {
    const { plan: slicedPlan } = seedSlicedPlan();
    const fakeStage = createFakeStage(JSON.stringify({ notes: "", slices: slicedPlan }));
    const fakeGh = createFakeGh();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runNamedStage("audit-and-publish", "13", fakeStage.exec, fakeGh.gh);

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      expect.stringMatching(/^audit-and-publish: 1 slice, /),
      "audit-and-publish: published 1 sub-issue under #13",
    ]);
  });

  it("exits nonzero without publishing when the audited plan fails validate-graph.ts", async () => {
    seedSlicedPlan();
    const selfReferencingPlan = [slice({ title: "Self-referencing slice", dependsOn: [1] })];
    const fakeStage = createFakeStage(JSON.stringify({ slices: selfReferencingPlan }));
    const fakeGh = createFakeGh();

    await expect(runNamedStage("audit-and-publish", "13", fakeStage.exec, fakeGh.gh)).rejects.toThrow(
      /depends on itself/,
    );
    expect(fakeGh.calls).toHaveLength(0);
  });

  it("exits nonzero without publishing when the auditor's response fails schema validation", async () => {
    seedSlicedPlan();
    const fakeStage = createFakeStage(
      JSON.stringify({ slices: [{ title: "Missing everything else" }] }),
    );
    const fakeGh = createFakeGh();

    await expect(runNamedStage("audit-and-publish", "13", fakeStage.exec, fakeGh.gh)).rejects.toThrow(
      /failed schema validation/,
    );
    expect(fakeGh.calls).toHaveLength(0);
  });
});

/**
 * #151: every stage that emits a plan prints one line saying how close the
 * plan came to the `Slice` caps, so the next decision about the audit stage
 * (#148) is made on measurements across runs rather than on one run. The
 * shape is pinned exactly here, for a plan built to have a known answer:
 * the slice count, the widest `filesClaimed`, and each capped field's longest
 * value over its ceiling.
 */
describe("a plan-emitting stage prints one measurement line against the Slice caps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A criterion of exactly `length` characters that a publisher will still
   * accept — padding plus a real `check:` marker (`render-body.ts`). The
   * measurement is about length, but `audit-and-publish` publishes the plan it
   * measures, and a criterion `bin/close-ticket` could not run never gets that
   * far (#215).
   */
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
      // Edged onto "Narrow" so the plan has exactly one unblocked root, which `validatePlan` now
      // requires (#240). Nothing the measurement line reports reads `dependsOn`.
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
    const fakeStage = createFakeStage(JSON.stringify({ notes: "", slices: knownPlan }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runNamedStage("audit-and-publish", "13", fakeStage.exec, createFakeGh().gh);

    expect(logSpy.mock.calls.map((call) => call[0])).toContain(`audit-and-publish: ${expectedLine}`);
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

    // DEFAULT_HANDOFF_PATH is repo-relative by design (that's the fallback
    // under test), which means it resolves against process.cwd() — the real
    // checkout root, shared by every worker in this suite's pool. Pinning
    // the relative-path behaviour without colliding with a sibling worker
    // means giving this one test a private cwd for its duration, not a
    // private handoff path (#222): a fixed absolute path here would stop
    // testing the fallback it exists to pin. chdir is process-wide within a
    // vitest worker, so it must be restored — and the temp dir removed —
    // before this test hands the worker back, success or failure.
    const cwd = mkdtempSync(join(tmpdir(), "handoff-cwd-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      expect(handoffPath()).toBe(DEFAULT_HANDOFF_PATH);

      writeFailure("seam-sweep", "boom");

      expect(readFileSync(join(cwd, DEFAULT_HANDOFF_PATH), "utf8")).toBe("seam-sweep: boom\n");
    } finally {
      process.chdir(originalCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/**
 * The two properties the checkpoint move exists for, pinned directly rather
 * than as a side effect of some other test's assertions.
 */
describe("stage output moved from the shared handoff to per-stage checkpoints", () => {
  it("readPriorHandoff reads the upstream stage's checkpoint file, not the shared handoff", async () => {
    const dir = withHandoffDir();
    const target = join(dir, "handoff.txt");
    process.env.FAILURE_REASON_PATH = target;
    // Poisoned on purpose: if slice's SEAM_MANIFEST substitution ever again
    // read the shared handoff, this text — not a seam manifest at all —
    // would reach the model's prompt.
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

  it("to-tickets.ts keeps no local preservingRaw or rawResponsePath copy", () => {
    const source = readFileSync(TO_TICKETS_PATH, "utf8");

    expect(source).not.toMatch(/function\s+preservingRaw/);
    expect(source).not.toMatch(/function\s+rawResponsePath/);
  });
});

/**
 * These exercise the real `--stage seam-sweep` CLI end to end, with a stub
 * `claude` executable placed first on PATH standing in for the model —
 * proving the wiring (argv, extraction, schema, checkpoint write, exit code)
 * without launching one.
 */
describe("to-tickets.ts --stage seam-sweep (CLI)", () => {
  it("writes a schema-valid manifest to its checkpoint and exits 0", async () => {
    const dir = withHandoffDir();
    const { env } = stubClaudeCli(dir, { structured: { entries: ["a seam"] } });

    execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "seam-sweep", "--issue", "13"], {
      env,
      encoding: "utf8",
    });

    const checkpoint = JSON.parse(readFileSync(checkpointPath("seam-sweep"), "utf8"));
    expect(JSON.parse(checkpoint.response)).toEqual({ entries: ["a seam"] });
  });

  it("writes a failure reason naming the stage and exits nonzero when the run produced no structured output", async () => {
    const dir = withHandoffDir();
    // A result event carrying prose and no `structured_output` — what the
    // CLI reports when the model never reached the tool. There is no such
    // response in ordinary traffic, and the point is that the stage names it
    // rather than dying on a `SyntaxError` about position 0.
    const { env, handoffFile } = stubClaudeCli(dir, "the model just talked, and never called the tool");

    expect(() =>
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "seam-sweep", "--issue", "13"], {
        env,
        encoding: "utf8",
      }),
    ).toThrow();

    expect(readFileSync(handoffFile, "utf8")).toMatch(/^seam-sweep: .*not valid JSON/);
  });

  it("writes a failure reason naming the stage and exits nonzero when the manifest fails schema validation", async () => {
    const dir = withHandoffDir();
    // A manifest entry with a newline in it: the rule `SeamManifestEntry`
    // carries as a `.refine()`, which has no JSON Schema form — so the API
    // accepts this and zod is what refuses it. That split is the reason
    // `parse` runs the schema over structured output at all.
    const { env, handoffFile } = stubClaudeCli(dir, {
      structured: { entries: ["one line\ntwo lines"] },
    });

    expect(() =>
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "seam-sweep", "--issue", "13"], {
        env,
        encoding: "utf8",
      }),
    ).toThrow();

    expect(readFileSync(handoffFile, "utf8")).toMatch(/^seam-sweep: .*failed schema validation/);
  });
});

/**
 * #42's other half, exercised through `runNamedStage` rather than the CLI:
 * the behaviour under test is what a stage does with a response it refuses,
 * which needs no subprocess. The CLI tests above already own the
 * reason-reaches-the-handoff half, and an in-process test of an in-process
 * behaviour is the cheaper and more direct one either way. (This used to be
 * argued from the 5000ms default timeout, which every extra `npx tsx` spawn
 * ate ~5s of. That budget is gone — see ADR-0015 — but the choice stands on
 * its own.)
 *
 * Run 32677530530 spent two minutes of real model time and left one line
 * about why it died; the response itself was never written anywhere, so the
 * first thing #42 asks for — look at the actual response — could not be
 * done from the run that raised it.
 */
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

/**
 * These exercise the real `--stage slice` CLI end to end, with a stub
 * `claude` executable standing in for the model — and, unlike seam-sweep's
 * CLI tests above, a seam manifest pre-seeded at seam-sweep's checkpoint,
 * since slice reads that as its SEAM_MANIFEST input before it runs.
 */
describe("to-tickets.ts --stage slice (CLI)", () => {
  const validPlan = [slice({ title: "One slice" })];
  const seamSweepCheckpoint = { stage: "seam-sweep", response: seamSweepResponse(["a seam"]) };

  /** Runs `--stage slice` against `plan` and asserts it fails, naming `pattern` in the handoff. */
  function expectSliceFailure(plan: Slice[], pattern: RegExp): void {
    const dir = withHandoffDir();
    const { env, handoffFile } = stubClaudeCli(dir, { structured: { slices: plan } }, seamSweepCheckpoint);

    expect(() =>
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "slice", "--issue", "13"], {
        env,
        encoding: "utf8",
      }),
    ).toThrow();

    expect(readFileSync(handoffFile, "utf8")).toMatch(pattern);
  }

  it("writes a schema- and graph-valid plan to its checkpoint and exits 0", async () => {
    const dir = withHandoffDir();
    const { env } = stubClaudeCli(dir, { structured: { slices: validPlan } }, seamSweepCheckpoint);

    execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "slice", "--issue", "13"], {
      env,
      encoding: "utf8",
    });

    const checkpoint = JSON.parse(readFileSync(checkpointPath("slice"), "utf8"));
    expect(JSON.parse(checkpoint.response)).toEqual({ slices: validPlan });
  });

  it("writes a failure reason naming the stage and exits nonzero when the plan fails schema validation", () => {
    expectSliceFailure([slice({ title: "Untestable", acceptanceCriteria: [] })], /^slice: .*failed schema validation/);
  });

  it("writes a failure reason naming the stage and exits nonzero when the graph is malformed", () => {
    expectSliceFailure([slice({ title: "A", dependsOn: [1] })], /^slice: .*depends on itself/);
  });
});
