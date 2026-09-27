import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { FINDINGS_POSTED, heard, holds, researching, wellFormedNote } from "./scenarios.ts";

const WORKFLOWS = join(import.meta.dirname, "..", ".github", "workflows");

const onlyJob = (file: string): { if?: string } => {
  const { jobs } = parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { jobs: Record<string, { if?: string }> };
  const [job] = Object.values(jobs);
  if (job === undefined) throw new Error(`no job in ${file}`);
  return job;
};

describe("bin/research answers a research note on the note and closes it, with nobody in the loop (#902)", () => {
  it("posts the findings on the note, then closes it as completed", () => {
    const answered = researching();

    expect(heard(answered.run())).toEqual({ status: 0, stderr: "", lines: [`research: #902 is answered and closed: ${FINDINGS_POSTED}`] });
    expect(answered.calls()).toEqual(["issue view 902", "issue comment 902", "issue close 902"]);
    expect(answered.comments()).toEqual(["The closer judges only an issue with checks, so a note waits on a session."]);
    expect(answered.handed()).toContain("# What does the closer judge");
    expect(answered.handed()).toContain(wellFormedNote.trim());
  });

  it("hires a model that can read the repo and the web and nothing else", () => {
    const { run, hired } = researching();

    expect(run().status).toBe(0);
    expect(hired()[hired().indexOf("--tools") + 1]).toBe("Read,Grep,Glob,WebSearch,WebFetch");
  });

  it("refuses an issue not labelled research, so it never closes a ticket, and spends no model", () => {
    const { run, calls, hired } = researching({ labels: ["note"] });

    expect(run()).toEqual({ status: 1, stdout: "", stderr: "research: #902 is not a research note, so nothing answered or closed it\n" });
    expect(calls()).toEqual(["issue view 902"]);
    expect(hired()).toEqual([]);
  });

  it("leaves the note open when its findings will not post", () => {
    const { run, calls } = researching({ gh: "[[ $2 == comment ]] && { printf 'HTTP 403: Resource not accessible\\n' >&2; exit 1; }" });

    expect(run()).toEqual({ status: 1, stdout: "", stderr: "research: #902 ended red, its findings would not post: gh issue comment failed: HTTP 403: Resource not accessible\n" });
    expect(calls()).toEqual(["issue view 902", "issue comment 902"]);
  });

  it("refuses anything but one issue number, and asks GitHub for nothing", () => {
    const { run, calls } = researching();

    expect(run("902", "903").status).toBe(2);
    expect(run("#902").status).toBe(2);
    expect(calls()).toEqual([]);
  });

  it("the owner's research note starts research.yml and never a build", () => {
    const research = onlyJob("research.yml");
    const build = onlyJob("build.yml");
    const researches = (labels: string[], sender = "collod873") => holds(research.if ?? "true", { labels, sender });

    expect(researches(["note", "research"])).toBe(true);
    expect(researches(["note"])).toBe(false);
    expect(researches([])).toBe(false);
    expect(researches(["note", "research"], "stranger")).toBe(false);
    expect(holds(build.if ?? "true", { labels: ["note", "research"] })).toBe(false);
  });
});
