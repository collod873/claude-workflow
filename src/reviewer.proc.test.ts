import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { cloned, fileDiff, git, JUDGEMENT, plant, reviewing, scratch } from "./scenarios.ts";
import { claims, ticketRefusals } from "./ticket-shape.ts";

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
    expect(review.if).toContain("startsWith(github.head_ref, 'ticket/')");
    expect(review.steps?.some((step) => /(^|\/)bin\/review /m.test(step.run ?? ""))).toBe(true);

    const { run, spent, comments } = reviewing({ branch: "land/session" });
    expect(run().status).toBe(0);
    expect(spent()).toBe(false);
    expect(comments()).toEqual([]);
  });
});

const TURN_TAKEN = "The fixer took its one turn on this ticket.";
const EARLIER = "The reviewer read this PR against the Why of #810 and found drift.\n\n- the `steps` context lists only steps that carry an id\n";
const STILL_OPEN = "the `steps` context still lists only steps that carry an id";
const LATE = "the comment step runs gh with no GH_REPO, so it fails before any checkout";
const LATER = {
  gap: LATE,
  title: "Name the repo on every step that runs gh",
  criteria: ['Every step that runs gh names its repo - check: `npx vitest run --config vitest.config.ts build-workflow -t "names its repo on every gh step"`'],
  claimed: [".github/workflows/check.yml", "src/build-workflow.proc.test.ts"],
};
const REPAIRED = "export const repaired = 1;\n";
const afterTurn = (verdict: { verdict: string; gaps: string[]; later?: unknown[] }, extra: { turns?: string[]; body?: string } = {}) =>
  reviewing({ turns: [TURN_TAKEN, ...(extra.turns ?? [])], onPr: [EARLIER], repair: REPAIRED, verdict, body: extra.body });

describe("bin/review names every gap in one pass, and after the fixer's turn only the earlier gaps or the fix's own lines block (#865)", () => {
  it("asks for every gap it finds in one pass, not the first one", () => {
    const { run, handed } = reviewing();

    expect(run().status).toBe(0);
    expect(handed().split("## Your verdict")[1]).toMatch(/every gap/i);
    expect(handed()).not.toContain("## The fixer's turn");
  });

  it("hands the earlier gaps and the fix's own diff once the fixer took its turn on a drift", () => {
    const { run, handed } = reviewing({ turns: [TURN_TAKEN], onPr: ["a comment nobody needs", EARLIER], repair: "export const repaired = 1;\n" });

    expect(run().status).toBe(0);
    const bounded = handed().split("## The fixer's turn")[1] ?? "";
    expect(bounded).toContain("lists only steps that carry an id");
    expect(bounded).toContain("+export const repaired = 1;");
    expect(bounded).not.toContain("a comment nobody needs");
    expect(bounded).toMatch(/later/);
  });

  it("reads a stranger's marker and gaps as no turn taken", () => {
    const { run, handed } = reviewing({ turns: [{ author: "stranger", body: TURN_TAKEN }], onPr: [{ author: "stranger", body: EARLIER }], repair: REPAIRED });

    expect(run().status).toBe(0);
    expect(handed()).not.toContain("## The fixer's turn");
  });

  it("merges past a later find, posting it once on the ticket, and ends red only on a blocking gap", () => {
    const later = afterTurn({ verdict: "match", gaps: [], later: [LATER] });

    const merged = later.run();
    expect(merged.status).toBe(0);
    expect(later.comments()).toEqual([]);
    expect(later.ticketComments()).toEqual([expect.stringContaining(LATE)]);

    const again = afterTurn({ verdict: "match", gaps: [], later: [LATER] }, { turns: [later.ticketComments()[0]] });
    expect(again.run().status).toBe(0);
    expect(again.ticketComments()).toEqual([]);
    expect(again.filed()).toEqual([]);

    const blocked = afterTurn({ verdict: "drift", gaps: [STILL_OPEN], later: [LATER] });
    expect(blocked.run().status).toBe(1);
    expect(blocked.comments()).toEqual([expect.stringContaining(STILL_OPEN)]);
    expect(blocked.comments()[0]).not.toContain(LATE);
  });

  it("blocks on every gap it names before the fixer's turn, later ones included", () => {
    const { run, comments, filed } = reviewing({ onPr: [EARLIER], verdict: { verdict: "drift", gaps: [STILL_OPEN], later: [LATER] } });

    expect(run().status).toBe(1);
    expect(comments()[0]).toContain(STILL_OPEN);
    expect(comments()[0]).toContain(LATE);
    expect(filed()).toEqual([]);
  });
});

const FOLLOW_UP_TICKET = [
  "## Why",
  "",
  "Follow-up of #700: its review found this after the fixer's one turn.",
  "",
  "> the closer never names the ticket it closed",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The closer names its ticket - check: `npx vitest run --config vitest.config.ts closer`",
  "",
  "## Files claimed",
  "",
  "- src/closer.ts",
  "",
].join("\n");

describe("a later find becomes a follow-up ticket that builds itself, one generation deep (#865)", () => {
  it("files each later find as a ticket the machine builds, after claiming the finds on the ticket so a rerun files nothing", () => {
    const { run, filed, order, ticketComments } = afterTurn({ verdict: "match", gaps: [], later: [LATER] });

    expect(run().status).toBe(0);
    expect(filed()).toHaveLength(1);
    const [{ title, body }] = filed();
    expect(title).toBe(LATER.title);
    expect(ticketRefusals(body)).toEqual([]);
    expect(body).toContain("Follow-up of #810");
    expect(body).toContain(LATE);
    expect(claims(body)).toEqual(LATER.claimed);
    expect(order().indexOf("issue comment")).toBeLessThan(order().indexOf("issue create"));
    expect(ticketComments()[0]).toContain(LATE);
  });

  it("never files a follow-up of a follow-up; its later finds stay a comment on it", () => {
    const { run, filed, ticketComments } = afterTurn({ verdict: "match", gaps: [], later: [LATER] }, { body: FOLLOW_UP_TICKET });

    expect(run().status).toBe(0);
    expect(filed()).toEqual([]);
    expect(ticketComments()).toEqual([expect.stringContaining(LATE)]);
    expect(ticketComments()[0]).toMatch(/not filed/i);
  });

  it("leaves a finding it cannot shape into a ticket as a comment naming why", () => {
    const { run, filed, ticketComments } = afterTurn({ verdict: "match", gaps: [], later: [{ ...LATER, criteria: [] }] });

    expect(run().status).toBe(0);
    expect(filed()).toEqual([]);
    expect(ticketComments().join("\n")).toContain(LATE);
    expect(ticketComments().join("\n")).toMatch(/refused/);
  });

  it("files as the App, since a ticket filed with the job's own token starts no build", () => {
    const { jobs } = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { steps: { id?: string; uses?: string; run?: string; env?: Record<string, string> }[] }> };
    const steps = jobs.review.steps;
    const minted = steps.find((step) => step.uses?.startsWith("actions/create-github-app-token@") === true);
    const reviewer = steps.find((step) => /bin\/review /.test(step.run ?? ""));

    expect(reviewer?.env?.GH_TOKEN).toContain(`steps.${minted?.id}.outputs.token`);
  });
});

describe("bin/review --help prints its usage and exits clean, reading no PR and hiring no model (#842)", () => {
  it("prints its usage line to stdout and exits 0, reading no PR and hiring no model", () => {
    const { run, read, hired, spent } = reviewing();

    const result = run("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("review: usage: review <pr number>");
    expect(read()).toBe(false);
    expect(spent()).toBe(false);
    expect(hired()).toEqual([]);
  });
});

interface CheckStep {
  run?: string;
  env?: Record<string, string>;
}

interface CheckWorkflow {
  on: Record<string, unknown>;
  jobs: Record<string, { if?: string; steps: CheckStep[] }>;
}

const checkWorkflow = () => parse(readFileSync(WORKFLOW, "utf8")) as CheckWorkflow;
const stepRunning = (steps: CheckStep[], command: string) => steps.find((step) => (step.run ?? "").includes(command)) as CheckStep;
const JUDGED = ["vitest.config.ts", "src/growth-limits.proc.test.ts", "bin/review"];
const outsideAnyRepo = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

describe("check.yml judges a PR with main's reviewer and main's test count, whatever the PR changed (#652)", () => {
  it("runs from main's copy of itself and refuses a fork before any of its code runs", () => {
    const { on, jobs } = checkWorkflow();
    const guard = jobs.check.steps[0];
    const judged = (headRepo: string) =>
      spawnSync("bash", ["-e", "-c", guard.run ?? ""], { env: { ...process.env, HEAD_REPO: headRepo, GITHUB_REPOSITORY: "collod873/claude-workflow" }, encoding: "utf8" }).status;

    expect(Object.keys(on)).toContain("pull_request_target");
    expect(judged("collod873/claude-workflow")).toBe(0);
    expect(judged("stranger/claude-workflow")).toBe(1);
    expect(judged("")).toBe(1);
    expect(jobs.review.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });

  it("puts main's test runner and test count back, and reviews with main's reviewer, when the PR changed all three", () => {
    const { jobs } = checkWorkflow();
    const root = scratch("judged-");
    const { session } = cloned(root, "start");
    for (const path of JUDGED) plant(session, path, "main's copy\n");
    git(session, "add", ".");
    git(session, "commit", "--quiet", "-m", "main");
    git(session, "push", "--quiet", "origin", "main");
    git(session, "checkout", "--quiet", "-b", "ticket/9");
    for (const path of JUDGED) plant(session, path, "the PR's copy\n");
    git(session, "commit", "--quiet", "-am", "the PR");
    const runnerTemp = scratch("runner-");
    const run = (step: CheckStep) => spawnSync("bash", ["-e", "-c", step.run ?? ""], { cwd: session, env: { ...outsideAnyRepo, RUNNER_TEMP: runnerTemp }, encoding: "utf8" });

    expect(run(stepRunning(jobs.check.steps, "git checkout origin/main --")).status).toBe(0);
    expect(run(stepRunning(jobs.review.steps, "git worktree add")).status).toBe(0);

    expect(readFileSync(join(session, "vitest.config.ts"), "utf8")).toBe("main's copy\n");
    expect(readFileSync(join(session, "src/growth-limits.proc.test.ts"), "utf8")).toBe("main's copy\n");
    expect(readFileSync(join(session, "bin/review"), "utf8")).toBe("the PR's copy\n");
    expect(readFileSync(join(runnerTemp, "main", "bin/review"), "utf8")).toBe("main's copy\n");
    expect(stepRunning(jobs.review.steps, "bin/review ").run).toContain("$RUNNER_TEMP/main/bin/review ");
  });
});
