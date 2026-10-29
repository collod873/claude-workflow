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
    const { run, hired } = researching();

    expect(run().status).toBe(0);
    expect(hired()).not.toContain("--tools");
    expect(hired()[hired().indexOf("--model") + 1]).toBe("opus");
    expect(hired()[hired().indexOf("--settings") + 1]).not.toContain("this stage runs only its own commands");
  });

  it("tells the researcher where the run history and the session captures are, only when the job fetched them (#936, #937)", () => {
    const fetched = researching({ sources: "/runner/research-sources" });
    const bare = researching();

    expect(fetched.run().status).toBe(0);
    expect(bare.run().status).toBe(0);
    expect(fetched.handed()).toContain("`/runner/research-sources`");
    expect(bare.handed()).not.toContain("/runner/research-sources");
  });

  it("a researcher still reading when its reading time ends is told to write up what it has, and those findings post (#940)", () => {
    const cutOff = researching({ readsPastCap: true });

    expect(heard(cutOff.run())).toEqual({ status: 0, stderr: "", lines: [`research: #902 is answered and closed: ${FINDINGS_POSTED}`] });
    expect(cutOff.hired()).toContain("--resume");
    expect(cutOff.hired()[cutOff.hired().indexOf("--resume") + 1]).toBe(READING_SESSION);
    expect(cutOff.handed()).toBe(OUT_OF_TIME);
    expect(cutOff.calls()).toEqual(["issue view 902", "issue comment 902", "issue close 902"]);
  });

  it("specs.yml fetches the run history and copies in the stage's session captures from the caller's own runs and checkout, with the App's token, before the researcher starts (#936, #937, #931, #1151)", () => {
    const research = workflowJobs("specs.yml").research ?? { steps: [] };
    const { steps } = research;
    const staged = steps.findIndex((step) => step.uses === "./.github/actions/stage");
    const fetching = steps.find((step) => /RESEARCH_SOURCES=.*GITHUB_ENV/.test(step.run ?? ""));
    const fetched = steps.indexOf(fetching ?? {});
    const spent = steps.findIndex((step) => step.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined);

    expect(fetched).toBeGreaterThan(staged);
    expect(spent).toBeGreaterThan(fetched);
    expect(steps.some((step) => step.with?.repositories === "transcripts")).toBe(false);
    expect(String(fetching?.env?.GH_TOKEN)).toMatch(/steps\.app\.outputs\.token/);
    expect(research.env?.GH_REPO).toBe("${{ github.repository }}");
  });

  it("the stage action hands every job the owner's Workflow session captures, fetched with a token that only reads and never held by the model (#931)", () => {
    const { steps } = (parse(readFileSync(STAGE_ACTION, "utf8")) as { runs: { steps: WorkflowStep[] } }).runs;
    const minted = steps.findIndex((step) => step.with?.repositories === "transcripts");
    const fetched = steps.findIndex((step) => /SESSION_CAPTURES=.*GITHUB_ENV/.test(step.run ?? ""));
    const run = steps[fetched]?.run ?? "";

    expect(steps[minted]?.with).toMatchObject({ owner: "${{ github.repository_owner }}", "permission-contents": "read" });
    expect(fetched).toBeGreaterThan(minted);
    expect(run).toContain('rm -rf "$transcripts"');
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

  it("research added to a note by the owner or the machine's App starts the research job and never a build", async () => {
    const researches = (labels: string[], sender = "collod873") => starts("specs.yml", "research", { labels, sender, action: "labeled", label: "research" });

    expect(await researches(["note", "research"])).toBe(true);
    expect(await researches(["note", "research"], "collod873-machine[bot]")).toBe(true);
    expect(await researches(["note"])).toBe(false);
    expect(await researches([])).toBe(false);
    expect(await researches(["note", "research"], "stranger")).toBe(false);
    expect(await starts("tickets.yml", "build", { labels: ["note", "research"], action: "labeled", label: "research" })).toBe(false);
  });
});

describe("bin/research files what its findings call for, so a closed note leaves no work unseen (#1353)", () => {
  const fix = { fault: "bin/land posts its skipped review as review only, and Lumaria requires tickets / review.", title: "bin/land posts tickets / review where the ruleset requires it", done: ["A landing in Lumaria merges at once."] };
  const ask = "Whether every repo's check, review and pre-push match one shape; my pick is yes, in two steps.";

  it("files each fix as a ticket that builds at once and names the note, and the owner's choices as one note naming him, then closes", () => {
    const answered = researching({ fixes: [fix], asks: [ask] });

    expect(answered.run().status).toBe(0);
    expect(answered.calls()).toEqual(["issue view 902", "issue comment 902", "issue create --title", "issue create --title", "issue close 902"]);
    const [ticket, note] = answered.filed();
    expect(ticket?.title).toBe(fix.title);
    expect(ticket?.labels).toEqual(["ticket"]);
    expect(ticket?.body).toContain("Follow-up of #902: its research found this.");
    expect(ticket?.body).toContain(`> ${fix.fault}`);
    expect(ticket?.body).toContain("## Done when\n\n- A landing in Lumaria merges at once.");
    expect(note?.title).toBe("Your call after #902: What does the closer judge");
    expect(note?.labels).toEqual(["note"]);
    expect(note?.body).toContain(`@collod873 #902's research leaves these to you:\n\n- ${ask}`);
  });

  it("files a step only the owner can take as an owner-step note naming the note, never as a ticket that builds, where #1759 built a fix waiting on a Stripe key", () => {
    const step = { title: "Put the Stripe sandbox key on the runner", why: "The stripe-contract step calls Stripe for real; file it once the key is there." };
    const answered = researching({ steps: [step] });

    expect(answered.run().status).toBe(0);
    const [note] = answered.filed();
    expect(note?.title).toBe(step.title);
    expect(note?.labels).toEqual(["note", "owner-step"]);
    expect(note?.body).toContain(step.why);
    expect(note?.body).toContain("#902");
  });

  it("files no more than three fixes, however many the researcher gives", () => {
    const answered = researching({ fixes: [fix, fix, fix, fix] });

    expect(answered.run().status).toBe(0);
    expect(answered.filed()).toHaveLength(3);
  });

  it("leaves the note open and ends red when a follow-up is refused, so the finding is not closed away", () => {
    const answered = researching({ fixes: [fix], gh: "[[ $2 == create ]] && { printf 'HTTP 403: Resource not accessible\\n' >&2; exit 1; }" });

    const { status, stderr } = answered.run();

    expect(status).toBe(1);
    expect(stderr).toContain("research: #902 is answered but its follow-ups were refused, so it stays open: ");
    expect(answered.calls()).not.toContain("issue close 902");
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
