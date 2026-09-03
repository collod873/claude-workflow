import { describe, expect, it } from "vitest";
import { agentWorkflowFixtures, agentWorkflowTests, sharedModules } from "./sources.fixture.ts";

const SPAWNS = /execFileSync\(/;

const SETS_MAX_BUFFER = /maxBuffer:/;

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const seams = sharedModules()
  .map(({ name, source }) => ({ name, source: code(source) }))
  .filter(({ source }) => SPAWNS.test(source));

describe("every exec seam sets maxBuffer", () => {
  it("finds the seams, so a passing suite is not an empty sweep", () => {
    expect(seams.map(({ name }) => name).sort()).toEqual(expect.arrayContaining(["gh.ts", "git.ts"]));
  });

  it.each(seams)("$name", ({ name, source }) => {
    expect(
      SETS_MAX_BUFFER.test(source),
      `${name} spawns a child without setting maxBuffer — Node's 1 MB default makes any output past ` +
        "it exit `ENOBUFS`, an error that names neither the command nor the size",
    ).toBe(true);
  });
});

const INHERITS_ENV = /env:\s*(?:cliEnv\(process\.env|\{[\s\S]{0,400}?\.\.\.process\.env)/;
const POINTS_AT_A_REPO = /GITHUB_WORKSPACE/;

const NEUTRALISES = /TARGET_WORKSPACE/;

const spawningTests = agentWorkflowTests().filter(
  ({ source }) => SPAWNS.test(code(source)) && INHERITS_ENV.test(code(source)) && POINTS_AT_A_REPO.test(code(source)),
);

describe("a test spawning an entrypoint with the ambient environment neutralises TARGET_WORKSPACE", () => {
  it("finds the tests that spawn, so a passing suite is not an empty sweep", () => {
    expect(spawningTests.map(({ name }) => name)).toContainEqual(
      expect.stringMatching(/^agent-workflows\/observations\/run-audit(\.proc)?\.test\.ts$/),
    );
  });

  it.each(spawningTests)("$name", ({ name, source }) => {
    expect(
      NEUTRALISES.test(code(source)),
      `${name} spawns an entrypoint with the ambient environment and never mentions TARGET_WORKSPACE — ` +
        "every runner exports it and every entrypoint reads it ahead of GITHUB_WORKSPACE, so the child " +
        "will read the lane's target checkout rather than the repo this test built. Pass it explicitly, " +
        'or clear it with `TARGET_WORKSPACE: ""`',
    ).toBe(true);
  });
});

const SETS_STDIO = /stdio:/;

const testSideSpawners = [...agentWorkflowTests(), ...agentWorkflowFixtures()].filter(({ source }) =>
  SPAWNS.test(code(source)),
);

describe("every test-side spawner passes stdio", () => {
  it("finds the spawners, so a passing suite is not an empty sweep", () => {
    expect(testSideSpawners.map(({ name }) => name).sort()).toEqual(
      expect.arrayContaining([
        "agent-workflows/shared/temp-repo.fixture.ts",
        "agent-workflows/to-tickets/stage-cli.fixture.ts",
      ]),
    );
  });

  it.each(testSideSpawners)("$name", ({ name, source }) => {
    expect(
      SETS_STDIO.test(code(source)),
      `${name} spawns a child without passing stdio — execFileSync echoes the child's stderr to this ` +
        "process's stderr on top of capturing it, so a test exercising a failure path prints that failure " +
        "into the verify log, unlabelled and indistinguishable from a real one. Pass " +
        '`stdio: ["pipe", "pipe", "pipe"]`, which is the default minus the echo',
    ).toBe(true);
  });
});
