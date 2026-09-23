import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { fileDiff, JUDGEMENT, reviewing } from "./scenarios.ts";

const WORKFLOW = join(import.meta.dirname, "..", ".github", "workflows", "check.yml");

describe("bin/review reads a green ticket PR against its Why before it merges (#810)", () => {
  it("posts every gap the model named on the PR, unfiltered, and ends red on drift", () => {
    const gaps = [
      "src/reviewer.ts:12 posts only the first gap",
      "The Why asks for a guard on the ticket branch and none was built",
      "Nothing names where the job's secret comes from",
    ];
    const { run, comments } = reviewing({ verdict: { verdict: "drift", gaps } });

    const result = run();

    expect(result.status).toBe(1);
    expect(comments()).toHaveLength(1);
    for (const gap of gaps) expect(comments()[0]).toContain(gap);
    expect(result.stdout + result.stderr).toContain(JUDGEMENT);
  });

  it("passes a match and posts nothing", () => {
    const { run, comments, handed } = reviewing();

    expect(run().status).toBe(0);
    expect(comments()).toEqual([]);
    expect(handed()).toContain("a green build is read against what was meant before it merges");
    expect(handed()).toContain("A drift verdict posts every gap");
    expect(handed()).toContain("+export const reviewed = 1;");
  });

  it("hands the claimed files' diff and the list of every changed file when the whole is over the diff cap", () => {
    const bulk = "y".repeat(40 * 1024);
    const diff = [fileDiff("src/bulk.ts", bulk), fileDiff("src/reviewer.ts", "export const reviewed = 1;"), fileDiff("docs/notes.md", "a line nobody claimed")].join("");
    const { run, handed } = reviewing({ diff });

    expect(run().status).toBe(0);
    expect(handed()).toContain("+export const reviewed = 1;");
    expect(handed()).not.toContain("y".repeat(1024));
    expect(handed()).not.toContain("a line nobody claimed");
    for (const path of ["src/bulk.ts", "src/reviewer.ts", "docs/notes.md"]) expect(handed()).toContain(path);
  });

  it("hires its model through the stage launcher, so it runs under the owner's hooks and leaves its transcript in the machine logs", () => {
    const { root, run, hired } = reviewing();
    const capture = "python3 /runner/agent-hooks/hooks/session-capture.py";
    const settings = join(root, "agent-hooks.json");
    writeFileSync(settings, JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ command: capture }] }] } }));

    expect(run("9810", { AGENT_HOOKS_SETTINGS: settings }).status).toBe(0);
    expect(hired().join(" ")).toContain(capture);
    expect(hired()).toContain("stream-json");
    expect(readFileSync(join(root, ".git", "machine-logs", "review-9810.jsonl"), "utf8")).toContain('"verdict":"match"');
  });

  it("runs after the check and only on a ticket branch", () => {
    const review = (parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { needs?: string; if?: string; steps?: { run?: string }[] }> }).jobs.review;

    expect(review.needs).toBe("check");
    expect(review.if).toBe("startsWith(github.head_ref, 'ticket/')");
    expect(review.steps?.some((step) => /^bin\/review /m.test(step.run ?? ""))).toBe(true);

    const { run, spent, comments } = reviewing({ branch: "land/session" });
    expect(run().status).toBe(0);
    expect(spent()).toBe(false);
    expect(comments()).toEqual([]);
  });
});
