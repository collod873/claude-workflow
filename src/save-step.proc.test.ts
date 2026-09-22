import { describe, expect, it } from "vitest";
import { SAVED_PR, git, heard, saving } from "./scenarios.ts";

describe("the save step pushes the branch before anything can refuse it, and opens the PR red or green (#726)", () => {
  it("pushes the build as it stands past a gate that refuses it and a main that moved on, then opens the PR with auto-merge on", () => {
    const { run, built, pushed, judged, calls, session } = saving();

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining(SAVED_PR)] });
    expect(pushed()).toBe(built);
    expect(git(session, "rev-parse", "HEAD")).toBe(built);
    expect(judged()).toBe(false);
    expect(calls()).toEqual([
      [expect.stringMatching(/^issue view 726\b/), built],
      [expect.stringMatching(/^pr create .*--base main --head ticket\/726\b/), built],
      [expect.stringMatching(/^pr merge ticket\/726 --auto .*--match-head-commit [0-9a-f]{40}$/), built],
    ]);
  });

  it("says one line naming the branch it kept, and opens nothing, when the push fails", () => {
    const { run, pushed, calls } = saving({ remoteRefuses: "the remote refuses every push" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n")).toEqual([expect.stringContaining("ticket/726")]);
    expect(result.stderr).toMatch(/kept/);
    expect(pushed()).toBe("");
    expect(calls()).toEqual([]);
  });
});
