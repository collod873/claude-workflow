import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeStage } from "../shared/stage.fake";
import { handoffPath, runNamedStage, writeFailure } from "./to-tickets";

const TO_TICKETS_PATH = ".Workflow/agent-workflows/to-tickets/to-tickets.ts";
const DEFAULT_HANDOFF_PATH = ".Workflow/agent-workflows/handoff.txt";

describe("runNamedStage (seam-sweep, against the fake StageExec)", () => {
  const originalEnv = process.env.FAILURE_REASON_PATH;
  let dir: string | undefined;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FAILURE_REASON_PATH;
    } else {
      process.env.FAILURE_REASON_PATH = originalEnv;
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes a schema-valid manifest to the handoff path, with a fake StageExec returning a canned response", () => {
    dir = mkdtempSync(join(tmpdir(), "run-named-stage-"));
    const target = join(dir, "handoff.txt");
    process.env.FAILURE_REASON_PATH = target;
    const fake = createFakeStage('<output>["a seam"]</output>');

    const output = runNamedStage("seam-sweep", "13", fake.exec);

    expect(output).toEqual(["a seam"]);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(["a seam"]);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("runNamedStage (slice, against the fake StageExec)", () => {
  const originalEnv = process.env.FAILURE_REASON_PATH;
  let dir: string | undefined;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FAILURE_REASON_PATH;
    } else {
      process.env.FAILURE_REASON_PATH = originalEnv;
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function validSlicePlan() {
    return [
      {
        title: "One slice",
        whatToBuild: "Build the thing.",
        acceptanceCriteria: ["`npm test` exits 0"],
        filesClaimed: ["a/file.ts"],
        seamsConsumed: [],
        whyNotMerged: "It stands alone.",
        dependsOn: [],
      },
    ];
  }

  it("reads the seam-sweep handoff as SEAM_MANIFEST and writes a schema- and graph-valid plan to the handoff path", () => {
    dir = mkdtempSync(join(tmpdir(), "run-named-stage-slice-"));
    const target = join(dir, "handoff.txt");
    process.env.FAILURE_REASON_PATH = target;
    writeFileSync(target, JSON.stringify(["a seam"]), "utf8");
    const plan = validSlicePlan();
    const fake = createFakeStage(`<output>${JSON.stringify(plan)}</output>`);

    const output = runNamedStage("slice", "13", fake.exec);

    expect(output).toEqual(plan);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(plan);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0][1]).toContain('["a seam"]');
  });

  it("throws naming the offending slice when the plan passes schema but the graph is malformed", () => {
    dir = mkdtempSync(join(tmpdir(), "run-named-stage-slice-bad-graph-"));
    const target = join(dir, "handoff.txt");
    process.env.FAILURE_REASON_PATH = target;
    writeFileSync(target, JSON.stringify(["a seam"]), "utf8");
    const badPlan = [
      {
        title: "Self-referencing slice",
        whatToBuild: "Build the thing.",
        acceptanceCriteria: ["`npm test` exits 0"],
        filesClaimed: [],
        seamsConsumed: [],
        whyNotMerged: "It stands alone.",
        dependsOn: [1],
      },
    ];
    const fake = createFakeStage(`<output>${JSON.stringify(badPlan)}</output>`);

    expect(() => runNamedStage("slice", "13", fake.exec)).toThrow(/depends on itself/);
  });
});

describe("handoffPath / writeFailure (FAILURE_REASON_PATH reconciliation)", () => {
  const originalEnv = process.env.FAILURE_REASON_PATH;
  let dir: string | undefined;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FAILURE_REASON_PATH;
    } else {
      process.env.FAILURE_REASON_PATH = originalEnv;
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes to FAILURE_REASON_PATH when the environment sets it (the runner's shape)", () => {
    dir = mkdtempSync(join(tmpdir(), "handoff-env-set-"));
    const target = join(dir, "failure_reason.txt");
    process.env.FAILURE_REASON_PATH = target;

    expect(handoffPath()).toBe(target);

    writeFailure("seam-sweep", "boom");

    expect(readFileSync(target, "utf8")).toBe("seam-sweep: boom\n");
  });

  it("falls back to the repo-relative handoff path when FAILURE_REASON_PATH is unset (a local run)", () => {
    delete process.env.FAILURE_REASON_PATH;

    expect(handoffPath()).toBe(DEFAULT_HANDOFF_PATH);

    writeFailure("seam-sweep", "boom");

    expect(readFileSync(DEFAULT_HANDOFF_PATH, "utf8")).toBe("seam-sweep: boom\n");
  });
});

/**
 * These exercise the real `--stage seam-sweep` CLI end to end, with a stub
 * `claude` executable placed first on PATH standing in for the model —
 * proving the wiring (argv, extraction, schema, handoff write, exit code)
 * without launching one.
 */
describe("to-tickets.ts --stage seam-sweep (CLI)", () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  });

  function stubClaudeCli(stdout: string): { env: NodeJS.ProcessEnv; handoffFile: string } {
    workDir = mkdtempSync(join(tmpdir(), "seam-sweep-cli-"));

    const outputFile = join(workDir, "stub-output.txt");
    writeFileSync(outputFile, stdout, "utf8");

    const stubDir = join(workDir, "bin");
    mkdirSync(stubDir);
    const stubPath = join(stubDir, "claude");
    writeFileSync(stubPath, `#!/usr/bin/env bash\ncat "${outputFile}"\n`, "utf8");
    chmodSync(stubPath, 0o755);

    const handoffFile = join(workDir, "handoff.txt");
    const env = {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      FAILURE_REASON_PATH: handoffFile,
    };
    return { env, handoffFile };
  }

  it("writes a schema-valid manifest to the handoff path and exits 0", () => {
    const { env, handoffFile } = stubClaudeCli('<output>["a seam"]</output>');

    execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "seam-sweep", "--issue", "13"], {
      env,
      encoding: "utf8",
    });

    expect(JSON.parse(readFileSync(handoffFile, "utf8"))).toEqual(["a seam"]);
  });

  it("writes a failure reason naming the stage and exits nonzero when the <output> block is missing", () => {
    const { env, handoffFile } = stubClaudeCli("no output block here, just prose");

    expect(() =>
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "seam-sweep", "--issue", "13"], {
        env,
        encoding: "utf8",
      }),
    ).toThrow();

    expect(readFileSync(handoffFile, "utf8")).toMatch(/^seam-sweep: .*no <output> block/);
  });

  it("writes a failure reason naming the stage and exits nonzero when the manifest fails schema validation", () => {
    const { env, handoffFile } = stubClaudeCli("<output>[\"one line\\ntwo lines\"]</output>");

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
 * These exercise the real `--stage slice` CLI end to end, with a stub
 * `claude` executable standing in for the model — and, unlike seam-sweep's
 * CLI tests above, a seam manifest pre-seeded at the handoff path, since
 * slice reads that as its SEAM_MANIFEST input before it runs.
 */
describe("to-tickets.ts --stage slice (CLI)", () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  });

  function stubClaudeCliForSlice(
    stdout: string,
    priorManifest: string,
  ): { env: NodeJS.ProcessEnv; handoffFile: string } {
    workDir = mkdtempSync(join(tmpdir(), "slice-cli-"));

    const outputFile = join(workDir, "stub-output.txt");
    writeFileSync(outputFile, stdout, "utf8");

    const stubDir = join(workDir, "bin");
    mkdirSync(stubDir);
    const stubPath = join(stubDir, "claude");
    writeFileSync(stubPath, `#!/usr/bin/env bash\ncat "${outputFile}"\n`, "utf8");
    chmodSync(stubPath, 0o755);

    const handoffFile = join(workDir, "handoff.txt");
    writeFileSync(handoffFile, priorManifest, "utf8");

    const env = {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      FAILURE_REASON_PATH: handoffFile,
    };
    return { env, handoffFile };
  }

  const validPlan = [
    {
      title: "One slice",
      whatToBuild: "Build the thing.",
      acceptanceCriteria: ["`npm test` exits 0"],
      filesClaimed: [],
      seamsConsumed: [],
      whyNotMerged: "It stands alone.",
      dependsOn: [],
    },
  ];

  it("writes a schema- and graph-valid plan to the handoff path and exits 0", () => {
    const { env, handoffFile } = stubClaudeCliForSlice(
      `<output>${JSON.stringify(validPlan)}</output>`,
      JSON.stringify(["a seam"]),
    );

    execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "slice", "--issue", "13"], {
      env,
      encoding: "utf8",
    });

    expect(JSON.parse(readFileSync(handoffFile, "utf8"))).toEqual(validPlan);
  });

  it("writes a failure reason naming the stage and exits nonzero when the plan fails schema validation", () => {
    const badPlan = [
      {
        title: "Untestable",
        whatToBuild: "x",
        acceptanceCriteria: [],
        filesClaimed: [],
        seamsConsumed: [],
        whyNotMerged: "x",
        dependsOn: [],
      },
    ];
    const { env, handoffFile } = stubClaudeCliForSlice(
      `<output>${JSON.stringify(badPlan)}</output>`,
      JSON.stringify(["a seam"]),
    );

    expect(() =>
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "slice", "--issue", "13"], {
        env,
        encoding: "utf8",
      }),
    ).toThrow();

    expect(readFileSync(handoffFile, "utf8")).toMatch(/^slice: .*failed schema validation/);
  });

  it("writes a failure reason naming the stage and exits nonzero when the graph is malformed", () => {
    const cyclicPlan = [
      {
        title: "A",
        whatToBuild: "x",
        acceptanceCriteria: ["y"],
        filesClaimed: [],
        seamsConsumed: [],
        whyNotMerged: "x",
        dependsOn: [1],
      },
    ];
    const { env, handoffFile } = stubClaudeCliForSlice(
      `<output>${JSON.stringify(cyclicPlan)}</output>`,
      JSON.stringify(["a seam"]),
    );

    expect(() =>
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "slice", "--issue", "13"], {
        env,
        encoding: "utf8",
      }),
    ).toThrow();

    expect(readFileSync(handoffFile, "utf8")).toMatch(/^slice: .*depends on itself/);
  });
});
