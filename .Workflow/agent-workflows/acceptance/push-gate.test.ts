import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { landingFromEnv, runPushGate, type TestRunResult } from "./push-gate";

function pushGateDeps(result: TestRunResult) {
  const fake = createFakeGit(() => "");
  return {
    fake,
    deps: {
      runTests: () => result,
      git: fake.git,
      paths: ["tests/acceptance/foo.test.ts"],
      commitMessage: "Author an acceptance test for #162's criteria",
    },
  };
}

describe("runPushGate", () => {
  it("pushes nothing when a test file has a collection error", async () => {
    const { fake, deps } = pushGateDeps({
      collected: false,
      collectionError: "tests/acceptance/foo.test.ts: SyntaxError: Unexpected token",
      failures: [],
    });

    const outcome = await runPushGate(deps);

    expect(outcome.verdict).toBe("refused");
    expect(fake.calls.some((call) => call[0] === "push")).toBe(false);
    expect(fake.calls).toEqual([]); // refused before any git call at all
  });

  it("pushes exactly once when everything collects and every failure is an AssertionError", async () => {
    const { fake, deps } = pushGateDeps({
      collected: true,
      failures: [
        { name: "proves criterion one", errorName: "AssertionError" },
        { name: "proves criterion two", errorName: "AssertionError" },
      ],
    });

    const outcome = await runPushGate(deps);

    expect(outcome.verdict).toBe("pushed");
    const pushes = fake.calls.filter((call) => call[0] === "push");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toEqual(["push", "origin", "HEAD:main"]);
  });

  it("refuses, without pushing, when a collected test fails on something other than AssertionError", async () => {
    const { fake, deps } = pushGateDeps({
      collected: true,
      failures: [{ name: "reaches into an undefined helper", errorName: "TypeError" }],
    });

    const outcome = await runPushGate(deps);

    expect(outcome.verdict).toBe("refused");
    expect(fake.calls.some((call) => call[0] === "push")).toBe(false);
  });

  it("commits and pushes only the paths it was given", async () => {
    const { fake, deps } = pushGateDeps({ collected: true, failures: [] });

    await runPushGate(deps);

    const add = fake.calls.find((call) => call[0] === "add");
    expect(add).toEqual(["add", "tests/acceptance/foo.test.ts"]);
  });

  // #227: a reader more than one of a run's test files needs lives in a `.fixture.ts` beside them
  // rather than being copied into each. Under `ACCEPTANCE_TEST_DIR` it is inside the one directory
  // this lane may write, so it lands with the tests that import it — a run that pushed the tests
  // and left the fixture behind would be a suite that cannot collect.
  it("lands a .fixture.ts beside the tests, rather than treating it as an out-of-directory path", async () => {
    const fake = createFakeGit(() => "");
    const outcome = await runPushGate({
      runTests: () => ({
        collected: true,
        failures: [{ name: "proves criterion one", errorName: "AssertionError" }],
      }),
      git: fake.git,
      paths: ["tests/acceptance/227-one.test.ts", "tests/acceptance/workflow-shape.fixture.ts"],
      commitMessage: "Author acceptance tests for #227 from the spec alone",
    });

    expect(outcome.verdict).toBe("pushed");
    expect(fake.calls.find((call) => call[0] === "add")).toEqual([
      "add",
      "tests/acceptance/227-one.test.ts",
      "tests/acceptance/workflow-shape.fixture.ts",
    ]);
    expect(fake.calls.filter((call) => call[0] === "push")).toHaveLength(1);
  });
});

/**
 * ADR-0091: the job that spends the Opus author holds `contents: read`, so the push cannot happen
 * there. What the gate decides is unchanged — this is only about who carries the result to `main`.
 */
describe("runPushGate with the landing delegated", () => {
  it("commits and stops, touching neither origin nor main", async () => {
    const { fake, deps } = pushGateDeps({
      collected: true,
      failures: [{ name: "proves criterion one", errorName: "AssertionError" }],
    });

    const outcome = await runPushGate({ ...deps, landing: "commit" });

    expect(outcome.verdict).toBe("pushed");
    expect(fake.calls.map((call) => call[0])).toEqual(["add", "commit"]);
  });

  it("still refuses a broken test file, so delegating the push does not widen what may land", async () => {
    const { fake, deps } = pushGateDeps({
      collected: false,
      collectionError: "tests/acceptance/foo.test.ts: SyntaxError: Unexpected token",
      failures: [],
    });

    const outcome = await runPushGate({ ...deps, landing: "commit" });

    expect(outcome.verdict).toBe("refused");
    expect(fake.calls).toEqual([]);
  });

  it("leaves a real commit behind, which is what the pushing job turns into a patch", async () => {
    const { fake, deps } = pushGateDeps({ collected: true, failures: [] });

    await runPushGate({ ...deps, landing: "commit" });

    expect(fake.calls.find((call) => call[0] === "commit")).toEqual([
      "commit",
      "-m",
      "Author an acceptance test for #162's criteria",
    ]);
  });
});

describe("landingFromEnv", () => {
  it("delegates only on the exact opt-in a workflow sets", () => {
    expect(landingFromEnv({ ACCEPTANCE_LANDING: "commit" })).toBe("commit");
  });

  it("pushes by default, which is what the workstation and every write-token job want", () => {
    expect(landingFromEnv({})).toBe("push");
    expect(landingFromEnv({ ACCEPTANCE_LANDING: "" })).toBe("push");
    expect(landingFromEnv({ ACCEPTANCE_LANDING: "push" })).toBe("push");
  });
});
