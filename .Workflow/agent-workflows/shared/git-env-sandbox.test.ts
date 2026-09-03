import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GIT_LOCATION_VARS, TARGET_LOCATION_VARS } from "./child-env";
import { makeTempRepo, type TempRepo } from "./temp-repo.fixture.ts";

function branchTips(repo: TempRepo): string[] {
  return repo.git("for-each-ref", "--format=%(objectname)", "refs/heads").split("\n").filter((line) => line !== "");
}

describe("git location variables in the test environment", () => {
  it.each(GIT_LOCATION_VARS)("is not in the worker's environment: %s", (name) => {
    expect(process.env[name]).toBeUndefined();
  });

  it("keeps a fixture's commit in the fixture when the worker inherits a GIT_DIR naming another repo", () => {
    const fixture = makeTempRepo("git-env-fixture");
    const victim = makeTempRepo("git-env-victim");

    process.env.GIT_DIR = join(victim.dir, ".git");
    try {
      fixture.write("a.txt", "a");
      fixture.commit("seed");
    } finally {
      delete process.env.GIT_DIR;
    }

    expect(branchTips(fixture)).toHaveLength(1);
    expect(branchTips(victim)).toEqual([]);
  });
});

describe("the machine's location variable in the test environment", () => {
  it.each(TARGET_LOCATION_VARS)("is not in the worker's environment: %s", (name) => {
    expect(process.env[name]).toBeUndefined();
  });
});
