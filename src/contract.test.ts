import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT, contractSteps } from "./scenarios.ts";

const REPO = join(import.meta.dirname, "..");
const steps = contractSteps(readFileSync(join(REPO, CONTRACT), "utf8"));
const inFastCheck = Object.entries(steps)
  .filter(([, step]) => step.fast === true || step.each !== undefined)
  .map(([name]) => name);

describe("the check a session runs mid-work holds the steps a push refuses on, so bin/land never first learns of them (#874)", () => {
  it("runs typecheck, lint, unused, clones and written-twice in the fast check, and leaves the suite, prompts and links to the full check", () => {
    expect(inFastCheck.sort()).toEqual(["clones", "lint", "typecheck", "unused", "written-twice"]);
    expect(Object.keys(steps).sort()).toEqual(["clones", "links", "lint", "prompts", "test", "typecheck", "unused", "written-twice"]);
  });

  it("says why every step is there", () => {
    expect(Object.entries(steps).filter(([, step]) => (step.why ?? "").trim() === "").map(([name]) => name)).toEqual([]);
  });

  it("names each tool by its path under node_modules, since the runner puts nothing on PATH", () => {
    const commands = Object.values(steps).flatMap((step) => [step.run, ...(step.each === undefined ? [] : [step.each])]);

    expect(commands.filter((command) => !/^(node_modules\/\.bin\/[\w-]+|node) /.test(command))).toEqual([]);
  });
});
