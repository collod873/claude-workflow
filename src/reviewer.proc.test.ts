import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { cloned, fileDiff, git, JUDGEMENT, plant, reviewing, scratch } from "./scenarios.ts";
import { NO_EM_DASH, PLAIN_WORDS } from "./reviewer.ts";
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

  it("passes a match and posts its readback", () => {
    const { run, comments, handed } = reviewing();

    expect(run().status).toBe(0);
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).toContain("It now reads a green build against what was meant before it merges.");
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
    const review = jobNamed((parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { needs?: string; if?: string; steps?: { run?: string }[] }> }).jobs, "review");

    expect(review.needs).toBe("check");
    expect(review.if).toContain("startsWith(github.head_ref, 'ticket/')");
    expect(review.steps?.some((step) => /(^|\/)bin\/review /m.test(step.run ?? ""))).toBe(true);

    const { run, spent, comments } = reviewing({ branch: "land/session" });
    expect(run().status).toBe(0);
    expect(spent()).toBe(false);
    expect(comments()).toEqual([]);
  });
});

const READBACK_TICKET = [
  "## Why",
  "",
  "The owner, in session:",
  "",
  "> keep the fixer honest about drift",
  "> never touch the reviewer's own prompt",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] A drift verdict posts every gap - check: `npx vitest run --config vitest.config.ts reviewer`",
  "",
  "## Files claimed",
  "",
  "- src/reviewer.ts",
  "",
].join("\n");

describe("bin/review reads back the owner's own words on a match, then a plain-words account, then asks yes or no (#918)", () => {
  it("posts one readback comment on a match, quoting the Why's `>` lines (or its \"...\" quotes) byte for byte and in order before the plain-words account and a yes or no question; a drift posts none, and a refused post never stops the merge", () => {
    const account = "It now checks the ticket branch before it hires a model.";

    const quoted = reviewing({ body: READBACK_TICKET, verdict: { verdict: "match", gaps: [], readback: account } });
    expect(quoted.run().status).toBe(0);
    expect(quoted.comments()).toHaveLength(1);
    const [said] = quoted.comments();
    if (said === undefined) throw new Error("no comment posted");
    const first = said.indexOf("> keep the fixer honest about drift");
    const second = said.indexOf("> never touch the reviewer's own prompt");
    const at = said.indexOf(account);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(at).toBeGreaterThan(second);
    expect(said.trim()).toMatch(/\?$/);
    expect(said).toMatch(/\byes\b.*\bno\b|\bno\b.*\byes\b/is);

    const fallback = reviewing({ verdict: { verdict: "match", gaps: [], readback: account } });
    expect(fallback.run().status).toBe(0);
    expect(fallback.comments()[0]).toContain('"a green build is read against what was meant before it merges"');

    const drift = reviewing({ body: READBACK_TICKET, verdict: { verdict: "drift", gaps: ["the fixer never runs on a `drift`"], readback: "should never be posted" } });
    expect(drift.run().status).toBe(1);
    expect(drift.comments()).toHaveLength(1);
    expect(drift.comments()[0]).not.toContain("should never be posted");

    const refused = reviewing({ verdict: { verdict: "match", gaps: [], readback: account }, prCommentFails: true });
    expect(refused.run().status).toBe(0);
  });
});

describe("the reviewer's answer schema asks for plain words and refuses an account written in code (#918)", () => {
  it("refuses a plain words account that carries a backtick, a slash, or a file name with an extension, and its prompt asks for plain words a non-coder can follow", () => {
    const allowed = (text: string) => new RegExp(PLAIN_WORDS).test(text);
    expect(allowed("It now checks the ticket branch before it hires a model.")).toBe(true);
    expect(allowed("It reads the `pr diff` before judging.")).toBe(false);
    expect(allowed("It reads the docs/README before judging.")).toBe(false);
    expect(allowed("It reads reviewer.ts before judging.")).toBe(false);

    const { run, handed } = reviewing();
    expect(run().status).toBe(0);
    expect(handed()).toMatch(/does not read code/i);
    expect(handed()).toMatch(/what to try/i);
    expect(handed()).toMatch(/what should happen/i);
    expect(handed()).toMatch(/what it now does/i);
    expect(handed()).toMatch(/did not before/i);
  });
});

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
const afterRepair = (verdict: { verdict: string; gaps: string[]; later?: unknown[] }, extra: { turns?: string[]; body?: string } = {}) =>
  reviewing({ turns: extra.turns ?? [], onPr: [EARLIER], repair: REPAIRED, verdict, body: extra.body });

describe("bin/review names every gap in one pass, and after its fixer's repair only the earlier gaps or the fix's own lines block (#865, #898)", () => {
  it("asks for every gap it finds in one pass, not the first one", () => {
    const { run, handed } = reviewing();

    expect(run().status).toBe(0);
    expect(handed().split("## Your verdict")[1]).toMatch(/every gap/i);
    expect(handed()).not.toContain("## The fixer's repair");
  });

  it("hands the earlier gaps and the fix's own diff once its fixer repaired a drift", () => {
    const { run, handed } = reviewing({ onPr: ["a comment nobody needs", EARLIER], repair: "export const repaired = 1;\n" });

    expect(run().status).toBe(0);
    const bounded = handed().split("## The fixer's repair")[1] ?? "";
    expect(bounded).toContain("lists only steps that carry an id");
    expect(bounded).toContain("+export const repaired = 1;");
    expect(bounded).not.toContain("a comment nobody needs");
    expect(bounded).toMatch(/later/);
  });

  it("reads a drift with no fixer's repair after it, and a stranger's gaps, as nothing repaired", () => {
    const unrepaired = reviewing({ onPr: [EARLIER] });
    const forged = reviewing({ onPr: [{ author: "stranger", type: "User", body: EARLIER }], repair: REPAIRED });

    expect(unrepaired.run().status).toBe(0);
    expect(unrepaired.handed()).not.toContain("## The fixer's repair");
    expect(forged.run().status).toBe(0);
    expect(forged.handed()).not.toContain("## The fixer's repair");
  });

  it("merges past a later find, posting it once on the ticket, and ends red only on a blocking gap", () => {
    const later = afterRepair({ verdict: "match", gaps: [], later: [LATER] });

    const merged = later.run();
    expect(merged.status).toBe(0);
    expect(later.comments()).toHaveLength(1);
    expect(later.comments()[0]).not.toContain(LATE);
    expect(later.ticketComments()).toEqual([expect.stringContaining(LATE)]);

    const [turn] = later.ticketComments();
    if (turn === undefined) throw new Error("no comment on the ticket");
    const again = afterRepair({ verdict: "match", gaps: [], later: [LATER] }, { turns: [turn] });
    expect(again.run().status).toBe(0);
    expect(again.ticketComments()).toEqual([]);
    expect(again.filed()).toEqual([]);

    const blocked = afterRepair({ verdict: "drift", gaps: [STILL_OPEN], later: [LATER] });
    expect(blocked.run().status).toBe(1);
    expect(blocked.comments()).toEqual([expect.stringContaining(STILL_OPEN)]);
    expect(blocked.comments()[0]).not.toContain(LATE);
  });

  it("blocks on every gap it names before its fixer's repair, later ones included", () => {
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
    const { run, filed, order, ticketComments } = afterRepair({ verdict: "match", gaps: [], later: [LATER] });

    expect(run().status).toBe(0);
    expect(filed()).toHaveLength(1);
    const [filing] = filed();
    if (filing === undefined) throw new Error("no ticket filed");
    const { title, body } = filing;
    if (body === undefined) throw new Error("no --body on the filed ticket");
    expect(title).toBe(LATER.title);
    expect(ticketRefusals(body)).toEqual([]);
    expect(body).toContain("Follow-up of #810");
    expect(body).toContain(LATE);
    expect(claims(body)).toEqual(LATER.claimed);
    expect(order().indexOf("issue comment")).toBeLessThan(order().indexOf("issue create"));
    expect(ticketComments()[0]).toContain(LATE);
  });

  it("never files a follow-up of a follow-up; its later finds stay a comment on it", () => {
    const { run, filed, ticketComments } = afterRepair({ verdict: "match", gaps: [], later: [LATER] }, { body: FOLLOW_UP_TICKET });

    expect(run().status).toBe(0);
    expect(filed()).toEqual([]);
    expect(ticketComments()).toEqual([expect.stringContaining(LATE)]);
    expect(ticketComments()[0]).toMatch(/not filed/i);
  });

  it("leaves a finding it cannot shape into a ticket as a comment naming why", () => {
    const { run, filed, ticketComments } = afterRepair({ verdict: "match", gaps: [], later: [{ ...LATER, criteria: [] }] });

    expect(run().status).toBe(0);
    expect(filed()).toEqual([]);
    expect(ticketComments().join("\n")).toContain(LATE);
    expect(ticketComments().join("\n")).toMatch(/refused/);
  });

  it("files as the App, since a ticket filed with the job's own token starts no build", () => {
    const { jobs } = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { steps: { id?: string; uses?: string; run?: string; env?: Record<string, string> }[] }> };
    const steps = jobNamed(jobs, "review").steps;
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

describe("bin/review's depth (meter) reports the reviewer's depth findings on the PR body it reviews (#920)", () => {
  it("puts one depth line on the PR body, replaces an earlier depth line rather than adding a second, and leaves the verdict, what is posted, and whether the PR merges the same as without it, even when the PR body cannot be read or edited", () => {
    const findings = ["src/tangle.ts joins billing and shipping, which change for different reasons"];
    const matchVerdict = (depth?: string[]) => ({ verdict: "match", gaps: [], readback: "It now reads a green build against what was meant before it merges.", depth });
    const driftVerdict = (depth?: string[]) => ({ verdict: "drift", gaps: ["a real gap"], readback: "should never be posted", depth });

    const withDepth = reviewing({ verdict: matchVerdict(findings) });
    expect(withDepth.run().status).toBe(0);
    const [edit] = withDepth.edited();
    if (edit === undefined) throw new Error("no pr edit call");
    expect(edit).toContain(`depth (meter): would refuse, ${findings[0]}`);

    const noFindings = reviewing({ verdict: matchVerdict([]) });
    expect(noFindings.run().status).toBe(0);
    const [emptyEdit] = noFindings.edited();
    if (emptyEdit === undefined) throw new Error("no pr edit call");
    expect(emptyEdit).toContain("depth (meter): would refuse nothing");

    const already = reviewing({ prBody: "Builds #810\n\ndepth (meter): would refuse, an earlier finding\n", verdict: matchVerdict(findings) });
    expect(already.run().status).toBe(0);
    const [replaced] = already.edited();
    if (replaced === undefined) throw new Error("no pr edit call");
    expect(replaced.match(/depth \(meter\):/g)).toHaveLength(1);
    expect(replaced).toContain(findings[0]);
    expect(replaced).not.toContain("an earlier finding");
    expect(replaced).toContain("Builds #810");

    const baseline = reviewing({ verdict: driftVerdict(undefined) });
    const baselineRun = baseline.run();
    const withDepthDrift = reviewing({ verdict: driftVerdict(findings) });
    const depthRun = withDepthDrift.run();
    expect(depthRun.status).toBe(baselineRun.status);
    expect(withDepthDrift.comments()).toEqual(baseline.comments());

    const unreadable = reviewing({ prBodyUnreadable: true, verdict: matchVerdict(findings) });
    expect(unreadable.run().status).toBe(0);
    expect(unreadable.comments()).toHaveLength(1);

    const uneditable = reviewing({ prEditFails: true, verdict: driftVerdict(findings) });
    const uneditableRun = uneditable.run();
    expect(uneditableRun.status).toBe(1);
    expect(uneditable.comments()[0]).toContain("a real gap");
  });
});

function depthPrompt(): string {
  const { run, hired, handed } = reviewing();

  expect(run().status).toBe(0);

  const argv = hired();
  const schemaText = argv[argv.indexOf("--json-schema") + 1];
  if (schemaText === undefined) throw new Error("no --json-schema in the reviewer's argv");
  const schema = JSON.parse(schemaText) as { required: string[]; properties: { depth?: { type: string; minItems?: number; items?: { type: string; pattern: string } } } };
  expect(schema.required).toContain("depth");
  expect(schema.properties.depth?.type).toBe("array");
  expect(schema.properties.depth?.minItems).toBeUndefined();
  expect(schema.properties.depth?.items?.type).toBe("string");
  expect(schema.properties.depth?.items?.pattern).toBe(NO_EM_DASH);

  return handed();
}

describe("the reviewer's answer schema and prompt ask for each shallow, pass-through, or tangled module the diff touches (#920)", () => {
  it("requires a depth finding for each shallow module, pass-through, or tangle the diff adds or widens, allows an empty list, and names entry points Actions call and one-line test fixture helpers as not findings", () => {
    const prompt = depthPrompt();
    expect(prompt).toContain("each module the diff adds or widens");
    expect(prompt).toContain("shallow");
    expect(prompt).toContain("pass-through");
    expect(prompt).toContain("joins behaviours that change for different reasons");
    expect(prompt).toContain("naming the module");
    expect(prompt).toMatch(/entry points[^.]*Actions[^.]*call/i);
    expect(prompt).toMatch(/one-line test fixture helpers?/i);
    expect(prompt).toMatch(/not findings/i);
  });
});

describe("the reviewer's depth prompt also asks about a hand-off spelled on both sides instead of owned by one module (#922)", () => {
  it("asks for each marker comment, stop line, commit subject or PR body line where a writer and a reader each spell it rather than share a single message owner, naming both sides, and says text carried through one module's own exports is not a finding, while leaving the depth schema and its existing findings unchanged", () => {
    const prompt = depthPrompt();
    expect(prompt).toContain("each module the diff adds or widens");
    expect(prompt).toContain("joins behaviours that change for different reasons");
    expect(prompt).toMatch(/another stage or workflow/i);
    expect(prompt).toMatch(/marker comment/i);
    expect(prompt).toMatch(/stop line/i);
    expect(prompt).toMatch(/commit subject/i);
    expect(prompt).toMatch(/PR body line/i);
    expect(prompt).toMatch(/naming both/i);
    expect(prompt).toMatch(/message owner/i);
    expect(prompt).toMatch(/one module'?s (?:own )?exports/i);
    expect(prompt).toMatch(/not a finding/i);
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

function jobNamed<T>(jobs: Record<string, T>, name: string): T {
  const job = jobs[name];
  if (job === undefined) throw new Error(`no ${name} job in ${WORKFLOW}`);
  return job;
}

const checkWorkflow = () => parse(readFileSync(WORKFLOW, "utf8")) as CheckWorkflow;
const stepRunning = (steps: CheckStep[], command: string) => steps.find((step) => (step.run ?? "").includes(command)) as CheckStep;
const JUDGED = ["vitest.config.ts", "src/growth-limits.proc.test.ts", "bin/review"];
const outsideAnyRepo = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

describe("check.yml judges a PR with main's reviewer and main's test count, whatever the PR changed (#652)", () => {
  it("runs from main's copy of itself and refuses a fork before any of its code runs", () => {
    const { on, jobs } = checkWorkflow();
    const [guard] = jobNamed(jobs, "check").steps;
    if (guard === undefined) throw new Error(`no first step in the check job of ${WORKFLOW}`);
    const judged = (headRepo: string) =>
      spawnSync("bash", ["-e", "-c", guard.run ?? ""], { env: { ...process.env, HEAD_REPO: headRepo, GITHUB_REPOSITORY: "collod873/claude-workflow" }, encoding: "utf8" }).status;

    expect(Object.keys(on)).toContain("pull_request_target");
    expect(judged("collod873/claude-workflow")).toBe(0);
    expect(judged("stranger/claude-workflow")).toBe(1);
    expect(judged("")).toBe(1);
    expect(jobNamed(jobs, "review").if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
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

    expect(run(stepRunning(jobNamed(jobs, "check").steps, "git checkout origin/main --")).status).toBe(0);
    expect(run(stepRunning(jobNamed(jobs, "review").steps, "git worktree add")).status).toBe(0);

    expect(readFileSync(join(session, "vitest.config.ts"), "utf8")).toBe("main's copy\n");
    expect(readFileSync(join(session, "src/growth-limits.proc.test.ts"), "utf8")).toBe("main's copy\n");
    expect(readFileSync(join(session, "bin/review"), "utf8")).toBe("the PR's copy\n");
    expect(readFileSync(join(runnerTemp, "main", "bin/review"), "utf8")).toBe("main's copy\n");
    expect(stepRunning(jobNamed(jobs, "review").steps, "bin/review ").run).toContain("$RUNNER_TEMP/main/bin/review ");
  });
});
