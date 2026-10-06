import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { OUT_OF_TIME } from "./researcher.ts";
import { heard, starts, wellFormedNote, workflowJobs, type WorkflowStep } from "./scenarios.ts";
import { FINDINGS_POSTED, READING_SESSION, researching } from "./researcher.part.ts";

const STAGE_ACTION = join(import.meta.dirname, "..", ".github", "actions", "stage", "action.yml");

describe("bin/research answers a research note on the note and closes it, with nobody in the loop (#902)", () => {
  it("posts the findings on the note, then closes it as completed", () => {
    const answered = researching();

    expect(heard(answered.run())).toEqual({ status: 0, stderr: "", lines: [`research: #902 is answered and closed: ${FINDINGS_POSTED}`] });
    expect(answered.calls()).toEqual(["issue view 902", "issue comment 902", "issue close 902"]);
    expect(answered.comments()).toEqual(["The closer judges only an issue with checks, so a note waits on a session."]);
    expect(answered.handed()).toContain("# What does the closer judge");
    expect(answered.handed()).toContain(wellFormedNote.trim());
  });

  it("marks the note researching before the researcher is hired, so the owner sees it being answered (#1065)", () => {
    const { run, marked } = researching();

    expect(run().status).toBe(0);
    expect(marked()).toEqual(["902 researching before the model"]);
  });

  it("hires a model with the web and an open shell, so a note that counts is answered by a script (#945)", () => {
    const { run, hired, handed } = researching();

    expect(run().status).toBe(0);
    expect(hired()).not.toContain("--tools");
    expect(hired()[hired().indexOf("--model") + 1]).toBe("sonnet");
    expect(hired()[hired().indexOf("--settings") + 1]).not.toContain("this stage runs only its own commands");
    expect(handed()).toContain("You have a shell");
    expect(handed()).toContain("`/tmp`");
  });

  it("tells the researcher where the run history and the session captures are, only when the job fetched them (#936, #937)", () => {
    const fetched = researching({ sources: "/runner/research-sources" });
    const bare = researching();

    expect(fetched.run().status).toBe(0);
    expect(bare.run().status).toBe(0);
    for (const held of ["`/runner/research-sources`", "`runs.jsonl`", "`jobs.jsonl`", "`machine-logs/`", "`git-log.txt`", "`sessions/`"]) {
      expect(fetched.handed()).toContain(held);
      expect(bare.handed()).not.toContain(held);
    }
  });

  it("a researcher still reading when its reading time ends is told to write up what it has, and those findings post (#940)", () => {
    const cutOff = researching({ readsPastCap: true });

    expect(heard(cutOff.run())).toEqual({ status: 0, stderr: "", lines: [`research: #902 is answered and closed: ${FINDINGS_POSTED}`] });
    expect(cutOff.hired()).toContain("--resume");
    expect(cutOff.hired()[cutOff.hired().indexOf("--resume") + 1]).toBe(READING_SESSION);
    expect(cutOff.handed()).toBe(OUT_OF_TIME);
    expect(cutOff.calls()).toEqual(["issue view 902", "issue comment 902", "issue close 902"]);
  });

  it("research.yml fetches the run history and copies in the stage's session captures before the researcher starts, with tokens that only read (#936, #937, #931)", () => {
    const { permissions, steps } = workflowJobs("research.yml").research ?? { steps: [] };
    const staged = steps.findIndex((step) => step.uses === "./.github/actions/stage");
    const fetched = steps.findIndex((step) => /RESEARCH_SOURCES=.*GITHUB_ENV/.test(step.run ?? ""));
    const spent = steps.findIndex((step) => step.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined);
    const run = steps[fetched]?.run ?? "";

    expect(permissions).toEqual({ contents: "read", issues: "write", actions: "read" });
    expect(steps.some((step) => step.with?.repositories === "Knowledge-Base")).toBe(false);
    expect(fetched).toBeGreaterThan(staged);
    expect(spent).toBeGreaterThan(fetched);
    expect(run).toContain('"$SESSION_CAPTURES/."');
    for (const held of ["runs.jsonl", "jobs.jsonl", "machine-logs", "git-log.txt", "sessions"]) expect(run).toContain(`$sources/${held}`);
  });

  it("specs.yml fetches the same sources for a caller's note from the caller's own runs and checkout, with the App's token, before the researcher starts (#1151)", () => {
    const research = workflowJobs("specs.yml").research ?? { steps: [] };
    const { steps } = research;
    const staged = steps.findIndex((step) => step.uses === "./.github/actions/stage");
    const fetching = steps.find((step) => /RESEARCH_SOURCES=.*GITHUB_ENV/.test(step.run ?? ""));
    const fetched = steps.indexOf(fetching ?? {});
    const spent = steps.findIndex((step) => step.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined);
    const ours = workflowJobs("research.yml").research?.steps.find((step) => /RESEARCH_SOURCES=.*GITHUB_ENV/.test(step.run ?? ""));

    expect(fetched).toBeGreaterThan(staged);
    expect(spent).toBeGreaterThan(fetched);
    expect(fetching?.run).toBe(ours?.run);
    expect(fetching?.env?.GH_TOKEN).toBe("${{ steps.app.outputs.token }}");
    expect(research.env?.GH_REPO).toBe("${{ github.repository }}");
    expect((fetching as WorkflowStep & { "working-directory"?: string })["working-directory"]).toBe("tree");
  });

  it("the stage action hands every job the owner's Workflow session captures, fetched with a token that only reads and never held by the model (#931)", () => {
    const { steps } = (parse(readFileSync(STAGE_ACTION, "utf8")) as { runs: { steps: WorkflowStep[] } }).runs;
    const minted = steps.findIndex((step) => step.with?.repositories === "Knowledge-Base");
    const fetched = steps.findIndex((step) => /SESSION_CAPTURES=.*GITHUB_ENV/.test(step.run ?? ""));
    const run = steps[fetched]?.run ?? "";

    expect(steps[minted]?.with).toMatchObject({ owner: "${{ github.repository_owner }}", "permission-contents": "read" });
    expect(fetched).toBeGreaterThan(minted);
    expect(run).toContain("^project: .*(Workflow|claude-workflow|\\.agents)");
    expect(run).toContain('rm -rf "$knowledge"');
    expect(run).not.toMatch(/CAPTURES_TOKEN=|GITHUB_ENV.*TOKEN/);
  });

  it("refuses an issue not labelled research, so it never closes a ticket, and spends no model", () => {
    const { run, calls, hired, marked } = researching({ labels: ["note"] });

    expect(run()).toEqual({ status: 1, stdout: "", stderr: "research: #902 is not a research note, so nothing answered or closed it\n" });
    expect(calls()).toEqual(["issue view 902"]);
    expect(hired()).toEqual([]);
    expect(marked()).toEqual([]);
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

  it("the owner's research note starts research.yml and never a build", async () => {
    const researches = (labels: string[], sender = "collod873") => starts("research.yml", "research", { labels, sender });

    expect(await researches(["note", "research"])).toBe(true);
    expect(await researches(["note"])).toBe(false);
    expect(await researches([])).toBe(false);
    expect(await researches(["note", "research"], "stranger")).toBe(false);
    expect(await starts("build.yml", "build", { labels: ["note", "research"] })).toBe(false);
  });
});

describe("bin/research stops at a mark GitHub refused, so it hires no model on a note whose labels lag (#1107)", () => {
  it("ends red at the researching mark, naming the stage, the label and the note, and hires, posts and closes nothing after it", () => {
    const answered = researching({ markRefusal: "mark: #902 not labelled researching: HTTP 403: Resource not accessible by integration" });

    const { status, stderr } = answered.run();

    expect(status).toBe(1);
    expect(stderr).toContain("research: bin/mark #902 researching ended non-zero, so nothing after it is posted, closed, marked or hired\n");
    expect(answered.marked()).toEqual(["902 researching before the model"]);
    expect(answered.hired()).toEqual([]);
    expect(answered.comments()).toEqual([]);
    expect(answered.calls()).not.toContain("issue close 902");
  });
});
