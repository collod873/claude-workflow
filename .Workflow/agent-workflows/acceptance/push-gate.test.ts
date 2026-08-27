import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { runPushGate, type TestRunResult } from "./push-gate";

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
});
