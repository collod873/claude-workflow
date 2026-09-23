import { describe, expect, it } from "vitest";
import { SAVED_PR, git, heard, saving } from "./scenarios.ts";

function savedWithAutoMerge<Saved extends ReturnType<typeof saving>>(saved: Saved, opening: RegExp[]): Saved {
  expect(heard(saved.run())).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining(SAVED_PR)] });
  expect(saved.pushed()).toBe(saved.built);
  expect(saved.calls()).toEqual([
    [expect.stringMatching(/^issue view 726\b/), saved.built],
    ...opening.map((call) => [expect.stringMatching(call), saved.built]),
    [expect.stringMatching(/^pr merge ticket\/726 --auto .*--match-head-commit [0-9a-f]{40}$/), saved.built],
  ]);
  return saved;
}

describe("the save step pushes the branch before anything can refuse it, and opens the PR red or green (#726)", () => {
  it("pushes the build as it stands past a gate that refuses it and a main that moved on, then opens the PR with auto-merge on", () => {
    const { session, built, judged } = savedWithAutoMerge(saving(), [/^pr create .*--base main --head ticket\/726\b/]);

    expect(git(session, "rev-parse", "HEAD")).toBe(built);
    expect(judged()).toBe(false);
  });

  it("keeps the PR already open for the branch, with auto-merge on at the new head", () => {
    savedWithAutoMerge(saving({ alreadyOpen: true }), [/^pr create .*--head ticket\/726\b/, /^pr view ticket\/726\b/]);
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

describe("bin/save meters what each stage read outside its brief, from the stage's own stream (#809)", () => {
  it("reads outside the brief are counted and named per stage, from the stage's stream", () => {
    const { run, prBody } = saving({
      brief: ["# Brief for ticket 726", "", "## Claimed files", "", "### src/ticket-shape.ts", "", "1  export const shaped = 2;", ""].join("\n"),
      streams: {
        "test-author": ["src/ticket-shape.ts", "src/post.ts"],
        build: ["src/ticket-shape.ts"],
      },
    });

    const result = run();

    expect(result.status).toBe(0);
    const body = prBody();
    expect(body).toContain("Builds #726");
    expect(body).toMatch(/test-author read 1\b[^\n]*outside its brief/);
    expect(body).toContain("src/post.ts");
    expect(body).toMatch(/build read 0\b[^\n]*outside its brief/);
    expect(body).not.toContain("ticket-shape");
  });
});
