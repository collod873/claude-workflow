import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { askingBash, cloned, fenceSays, flagValue, git, plant, scratch, starts } from "./scenarios.ts";
import { EARLY_REPAIR, fileDiff, BUILDER_LINE, FROM_MAIN, JUDGED_GAP, JUDGEMENT, RESOLVED, REVIEWED_TICKET, reviewing } from "./reviewer.part.ts";
import { capped, LIST_CAP, NO_EM_DASH, TICKET_CAP } from "./brief.ts";
import { METERS } from "./meter-reviewer.ts";
import { earlierDrift } from "./post.ts";
import { PLAIN_WORDS } from "./reviewer.ts";
import { doneWhen, ticketRefusals } from "./ticket-shape.ts";

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

  it("hands the reviewer and the meter reviewer the whole ticket body, a heading past its Why and Done when included, cut at the builder's cap (#1006)", () => {
    const body = `${REVIEWED_TICKET}\n## Context\n\nthe filer's note under its own heading\n\n${"z".repeat(TICKET_CAP)}a line past the cap\n`;
    for (const bin of ["review", "meters"] as const) {
      const { run, handed } = bin === "review" ? reviewing({ body }) : reviewing({ bin, body, verdict: Object.fromEntries(METERS.map(({ name }) => [name.replaceAll(" ", "_"), []])) });

      expect(run().status).toBe(0);
      expect(handed()).toContain(capped(body, TICKET_CAP));
      expect(handed()).toContain("the filer's note under its own heading");
      expect(handed()).not.toContain("a line past the cap");
    }
  });

  it("hands the reviewer the PR body, cut at its cap, so work a Done when asks outside the repo, such as a label renamed on GitHub, can be shown (#1166)", () => {
    const prBody = `Builds #810\n\n## Labels on GitHub\n\n- the old label renamed in place on collod873/claude-workflow\n\n${"w".repeat(LIST_CAP)}a line past the cap\n`;
    const { run, handed } = reviewing({ prBody });

    expect(run().status).toBe(0);
    expect(handed()).toContain("## The PR's body");
    expect(handed()).toContain("the old label renamed in place on collod873/claude-workflow");
    expect(handed()).not.toContain("a line past the cap");
  });

  it("ends red, hiring no model, when the PR body cannot be read (#1166)", () => {
    const { run, handed } = reviewing({ prBodyUnreadable: true });

    expect(run().status).not.toBe(0);
    expect(handed()).toBe("");
  });

  it("hands the diff cut at the cap and the list of every changed file when the whole is over the diff cap", () => {
    const bulk = "y".repeat(40 * 1024);
    const diff = [fileDiff("src/bulk.ts", bulk), fileDiff("docs/notes.md", "a line past the cap")].join("");
    const { run, handed } = reviewing({ diff });

    expect(run().status).toBe(0);
    expect(handed()).toContain("y".repeat(1024));
    expect(handed()).not.toContain(bulk);
    expect(handed()).not.toContain("a line past the cap");
    for (const path of ["src/bulk.ts", "docs/notes.md"]) expect(handed()).toContain(path);
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

  it("leaves every meter to the meter reviewer: it asks for no meter and never edits the PR body", () => {
    const { run, hired, handed, edited } = reviewing();

    expect(run().status).toBe(0);
    const argv = hired();
    const schema = JSON.parse(argv[argv.indexOf("--json-schema") + 1] ?? "{}") as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).not.toContain("depth");
    expect(handed()).not.toMatch(/`depth`|pass-through/);
    expect(edited()).toEqual([]);
  });

  it("runs on a ticket branch only", async () => {
    const review = jobNamed((parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { needs?: string; if?: string; steps?: { run?: string }[] }> }).jobs, "review");

    expect(await starts("check.yml", "review", { head: "ticket/810" })).toBe(true);
    expect(await starts("check.yml", "review", { head: "land/session" })).toBe(false);
    expect(review.steps?.some((step) => /(^|\/)bin\/review /m.test(step.run ?? ""))).toBe(true);

    const { run, spent, comments } = reviewing({ branch: "land/session" });
    expect(run().status).toBe(0);
    expect(spent()).toBe(false);
    expect(comments()).toEqual([]);
  });
});

describe("bin/review fences its shell to the fast check and its plan, which the permission mode alone would not (#962)", () => {
  it("lets through `~/bin/check` and `~/bin/check --explain`, and refuses the full check and anything else", () => {
    const { run, hired } = reviewing();

    run();

    const argv = hired().join("\n");
    expect(fenceSays(argv, askingBash("~/bin/check")).status).toBe(0);
    expect(fenceSays(argv, askingBash("~/bin/check --explain")).status).toBe(0);
    expect(fenceSays(argv, askingBash("~/bin/check --full --publish")).status).toBe(2);
    const refused = fenceSays(argv, askingBash("touch unlisted-marker"));
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("~/bin/check, ~/bin/check --explain");
    expect(flagValue(argv, "--tools")).toBe("Read,Grep,Glob");
  });

  it("refuses a shell command its fence cannot read, rather than let it through", () => {
    const { run, hired } = reviewing();

    run();

    const argv = hired().join("\n");
    expect(fenceSays(argv, askingBash(42)).status).toBe(2);
    expect(fenceSays(argv, "what a broken hook call looks like").status).toBe(2);
  });
});

const READBACK_TICKET = [
  "## Why",
  "",
  "The owner, in session:",
  "",
  "> keep the builder honest about drift",
  "> never touch the reviewer's own prompt",
  "",
  "## Done when",
  "",
  "- A drift verdict posts every gap.",
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
    const first = said.indexOf("> keep the builder honest about drift");
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

    const drift = reviewing({ body: READBACK_TICKET, verdict: { verdict: "drift", gaps: ["the builder never runs on a `drift`"], readback: "should never be posted" } });
    expect(drift.run().status).toBe(1);
    expect(drift.comments()).toHaveLength(1);
    expect(drift.comments()[0]).not.toContain("should never be posted");

    const refused = reviewing({ verdict: { verdict: "match", gaps: [], readback: account }, prCommentFails: true });
    expect(refused.run().status).toBe(0);
  });
});

const OWNER_SPEC = { state: "open", user: { login: "collod873" }, labels: [{ name: "spec" }] };

describe("bin/review leaves the readback of a ticket under an open spec the owner opened to its wave's one note (#1039)", () => {
  it("posts a match under such a spec as its judgement, stamped so it is reused, with no readback and no question to the owner", () => {
    const diff = fileDiff("src/reviewer.ts", "export const reviewed = 1;");
    const account = "should never be posted, the wave's note reads it back";
    const { run, comments } = reviewing({ diff, body: READBACK_TICKET, spec: OWNER_SPEC, verdict: { verdict: "match", gaps: [], readback: account } });

    expect(run().status).toBe(0);
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).toContain(`Fingerprint: \`${fingerprintOf(diff, READBACK_TICKET)}\``);
    expect(comments()[0]).not.toContain(account);
    expect(comments()[0]).not.toContain("> keep the builder honest about drift");
    expect(comments()[0]).not.toMatch(/yes or no|\?/);
    expect(earlierDrift("810", [comments()[0] ?? ""])).toBe("");
  });

  it("keeps the readback of a ticket under no spec, a closed spec, or a spec the owner did not open", () => {
    const account = "It now checks the ticket branch before it hires a model.";
    for (const spec of [undefined, { ...OWNER_SPEC, state: "closed" }, { ...OWNER_SPEC, user: { login: "collod873-machine[bot]" } }, { ...OWNER_SPEC, labels: [] }]) {
      const { run, comments } = reviewing({ spec, verdict: { verdict: "match", gaps: [], readback: account } });
      expect(run().status).toBe(0);
      expect(comments()[0], JSON.stringify(spec)).toContain(account);
      expect(comments()[0]).toContain("yes or no");
    }
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
  done: ["Every step that runs gh names its repo."],
};
const REPAIRED = "export const repaired = 1;\n";
const afterRepair = (verdict: { verdict: string; gaps: string[]; later?: unknown[] }, extra: { turns?: string[]; body?: string } = {}) =>
  reviewing({ turns: extra.turns ?? [], onPr: [EARLIER], repair: REPAIRED, verdict, body: extra.body });

describe("bin/review names every gap in one pass, and after its builder's repair only the earlier gaps or the fix's own lines block (#865, #898)", () => {
  it("asks for every gap it finds in one pass, not the first one", () => {
    const { run, handed } = reviewing();

    expect(run().status).toBe(0);
    expect(handed().split("## Your verdict")[1]).toMatch(/every gap/i);
    expect(handed()).not.toContain("## The builder's repair");
  });

  it("hands the earlier gaps, and the whole PR diff as the fix after a drift judgement that recorded no head", () => {
    const { run, handed } = reviewing({ onPr: ["a comment nobody needs", EARLIER], repair: "export const repaired = 1;\n" });

    expect(run().status).toBe(0);
    const bounded = handed().split("## The builder's repair")[1] ?? "";
    expect(bounded).toContain("lists only steps that carry an id");
    expect(bounded).toContain("+export const reviewed = 1;");
    expect(bounded).not.toContain("a comment nobody needs");
    expect(bounded).toMatch(/later/);
  });

  it("hands the fix since the judged head: the builder's lines and its resolved conflict, not main's lines or a repair from before that judgement", () => {
    const { run, handed, comments } = reviewing({ judged: "merged", verdict: { verdict: "drift", gaps: [JUDGED_GAP] } });

    expect(run().status).toBe(1);
    const fix = (handed().split("## The builder's repair")[1] ?? "").split("## Your verdict")[0] ?? "";
    expect(fix).toContain(JUDGED_GAP);
    expect(fix).toContain(`+${BUILDER_LINE}`);
    expect(fix).toContain(`+${RESOLVED}`);
    expect(fix).not.toContain(FROM_MAIN);
    expect(fix).not.toContain(EARLY_REPAIR);
    expect(comments()[0]).toMatch(/^Head: `[0-9a-f]{40}`$/m);
  });

  it("reads a ticket-only turn as repaired: only the earlier gaps block, other finds go to later, and the fix reads as none", () => {
    const later = reviewing({ judged: "ticket", verdict: { verdict: "match", gaps: [], later: [LATER] } });

    expect(later.run().status).toBe(0);
    expect(later.handed()).toContain("## The builder's repair");
    expect(later.handed()).toContain("(none, the builder changed the ticket)");
    expect(later.ticketComments()).toEqual([expect.stringContaining(LATE)]);

    const blocked = reviewing({ judged: "ticket", verdict: { verdict: "drift", gaps: [JUDGED_GAP], later: [LATER] } });
    expect(blocked.run().status).toBe(1);
    expect(blocked.comments()).toEqual([expect.stringContaining(JUDGED_GAP)]);
    expect(blocked.comments()[0]).not.toContain(LATE);
  });

  it("reads a stranger's gaps as nothing repaired", () => {
    const forged = reviewing({ onPr: [{ author: "stranger", type: "User", body: EARLIER }], repair: REPAIRED });

    expect(forged.run().status).toBe(0);
    expect(forged.handed()).not.toContain("## The builder's repair");
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

  it("blocks on every gap it names before any drift judgement, later ones included", () => {
    const { run, comments, filed } = reviewing({ verdict: { verdict: "drift", gaps: [STILL_OPEN], later: [LATER] } });

    expect(run().status).toBe(1);
    expect(comments()[0]).toContain(STILL_OPEN);
    expect(comments()[0]).toContain(LATE);
    expect(filed()).toEqual([]);
  });
});

const FOLLOW_UP_TICKET = [
  "## Why",
  "",
  "Follow-up of #700: its review found this after the builder's one turn.",
  "",
  "The reviewer, on #700:",
  "",
  "> the closer never names the ticket it closed",
  "",
  "## Done when",
  "",
  "- The closer names its ticket.",
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
    expect(body.indexOf("The reviewer, on #810:")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("The reviewer, on #810:")).toBeLessThan(body.indexOf(`> ${LATE}`));
    expect(doneWhen(body)).toBe("- Every step that runs gh names its repo.");
    expect(order().indexOf("issue comment")).toBeLessThan(order().indexOf("issue create"));
    expect(ticketComments()[0]).toContain(LATE);
  });

  it("files each follow-up labelled `waiting`, so it builds only once its parent's PR merges or closes, on a main that holds it (#1033)", () => {
    const { run, filed, ticketComments } = afterRepair({ verdict: "match", gaps: [], later: [LATER] });

    expect(run().status).toBe(0);
    expect(filed().map(({ labels }) => labels)).toEqual([["ticket", "waiting"]]);
    expect(ticketComments()[0]).toMatch(/once this PR merges or closes/);
  });

  it("never files a follow-up of a follow-up; its later finds stay a comment on it", () => {
    const { run, filed, ticketComments } = afterRepair({ verdict: "match", gaps: [], later: [LATER] }, { body: FOLLOW_UP_TICKET });

    expect(run().status).toBe(0);
    expect(filed()).toEqual([]);
    expect(ticketComments()).toEqual([expect.stringContaining(LATE)]);
    expect(ticketComments()[0]).toMatch(/not filed/i);
  });

  it("reads back the owner's words from the ticket a follow-up follows up, never the reviewer's gap (#1005)", () => {
    const parent = { ticket: "700", body: READBACK_TICKET };
    const { run, comments } = reviewing({ body: FOLLOW_UP_TICKET, parent });

    expect(run().status).toBe(0);
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).toContain("> keep the builder honest about drift");
    expect(comments()[0]).toContain("> never touch the reviewer's own prompt");
    expect(comments()[0]).not.toContain("the closer never names the ticket it closed");
  });

  it("leaves a finding it cannot shape into a ticket as a comment naming why", () => {
    const { run, filed, ticketComments } = afterRepair({ verdict: "match", gaps: [], later: [{ ...LATER, done: [] }] });

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

function patchId(diff: string): string {
  const got = spawnSync("git", ["patch-id", "--stable"], { cwd: import.meta.dirname, input: diff, encoding: "utf8" });
  return got.stdout.trim().split(/\s+/)[0] ?? "";
}

function fingerprintOf(diff: string, body: string, prBody = "Builds #810\n"): string {
  return `${patchId(diff)}-${createHash("sha256").update(body).update(prBody).digest("hex").slice(0, 12)}`;
}

const matchComment = (fingerprint: string) => `It builds what the ticket asked.\n\nFingerprint: \`${fingerprint}\`\n`;
const driftComment = (ticket: string, fingerprint: string) => `The reviewer read this PR against the Why of #${ticket} and found drift.\n\n- an old gap\n\nFingerprint: \`${fingerprint}\`\n`;

function diffsAcrossMerge(): { before: string; after: string } {
  const repo = scratch("merge-diff-");
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "config", "user.email", "merge@test");
  git(repo, "config", "user.name", "merge");
  const original = `${Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
  plant(repo, "src/sample.ts", original);
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "base");
  git(repo, "checkout", "--quiet", "-b", "ticket/810");
  plant(repo, "src/sample.ts", original.replace("line 8", "line 8 changed by the ticket"));
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "the ticket's own change");
  const before = git(repo, "diff", "main...ticket/810");

  git(repo, "checkout", "--quiet", "main");
  plant(repo, "src/sample.ts", `shifted line a\nshifted line b\nshifted line c\n${original}`);
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "main moves on, shifting the lines below");

  git(repo, "checkout", "--quiet", "ticket/810");
  git(repo, "merge", "--quiet", "--no-edit", "main");
  const after = git(repo, "diff", "main...ticket/810");
  return { before, after };
}

describe("bin/review reuses its last judgement on the PR when what it judged has not changed (#955)", () => {
  it("reuses its last judgement when the diff and the ticket are unchanged, hiring no model and posting nothing, and ends as that judgement did", () => {
    const diff = fileDiff("src/reviewer.ts", "export const reviewed = 1;");

    const matched = reviewing({ diff, onPr: [matchComment(fingerprintOf(diff, REVIEWED_TICKET))] });
    const matchedResult = matched.run();
    expect(matchedResult.status).toBe(0);
    expect(matched.hired()).toEqual([]);
    expect(matched.comments()).toEqual([]);

    const drifted = reviewing({ diff, onPr: [driftComment("810", fingerprintOf(diff, REVIEWED_TICKET))], verdict: { verdict: "drift", gaps: ["should never be asked, the judgement is reused"] } });
    const driftedResult = drifted.run();
    expect(driftedResult.status).toBe(1);
    expect(drifted.hired()).toEqual([]);
    expect(drifted.comments()).toEqual([]);
  });

  it("judges afresh when the diff or the ticket changed since the last judgement, or no judgement on the PR carries a fingerprint, and posts the fingerprint it judged", () => {
    const diff = fileDiff("src/reviewer.ts", "export const reviewed = 1;");
    const otherDiff = fileDiff("src/reviewer.ts", "export const reviewed = 2;");
    const otherBody = REVIEWED_TICKET.replace("A drift verdict posts every gap", "A drift verdict posts every gap, sorted");

    const diffChanged = reviewing({ diff, onPr: [matchComment(fingerprintOf(otherDiff, REVIEWED_TICKET))] });
    expect(diffChanged.run().status).toBe(0);
    expect(diffChanged.hired()).not.toEqual([]);
    expect(diffChanged.comments()[0]).toContain(`Fingerprint: \`${fingerprintOf(diff, REVIEWED_TICKET)}\``);

    const ticketChanged = reviewing({ diff, body: otherBody, onPr: [matchComment(fingerprintOf(diff, REVIEWED_TICKET))] });
    expect(ticketChanged.run().status).toBe(0);
    expect(ticketChanged.hired()).not.toEqual([]);
    expect(ticketChanged.comments()[0]).toContain(`Fingerprint: \`${fingerprintOf(diff, otherBody)}\``);

    const noFingerprint = reviewing({ diff, onPr: ["a past judgement that carries no fingerprint at all"] });
    expect(noFingerprint.run().status).toBe(0);
    expect(noFingerprint.hired()).not.toEqual([]);
    expect(noFingerprint.comments()[0]).toContain(`Fingerprint: \`${fingerprintOf(diff, REVIEWED_TICKET)}\``);
  });

  it("judges afresh when the PR body changed outside its meter lines, and reuses its judgement when only a meter line changed (#1166)", () => {
    const diff = fileDiff("src/reviewer.ts", "export const reviewed = 1;");
    const before = "Builds #810\n";
    const told = "Builds #810\n\n## Labels on GitHub\n\n- renamed in place\n";

    const bodyChanged = reviewing({ diff, prBody: told, onPr: [driftComment("810", fingerprintOf(diff, REVIEWED_TICKET, before))] });
    expect(bodyChanged.run().status).toBe(0);
    expect(bodyChanged.hired()).not.toEqual([]);
    expect(bodyChanged.comments()[0]).toContain(`Fingerprint: \`${fingerprintOf(diff, REVIEWED_TICKET, told)}\``);

    const metered = `${told}\ndepth (meter): would refuse, a finding\n`;
    const meterChanged = reviewing({ diff, prBody: metered, onPr: [driftComment("810", fingerprintOf(diff, REVIEWED_TICKET, `${told}\n`))] });
    expect(meterChanged.run().status).toBe(1);
    expect(meterChanged.hired()).toEqual([]);
  });

  it("hands the reviewer the PR body without its meter lines, which only advise (#1166)", () => {
    const { run, handed } = reviewing({ prBody: "Builds #810\n\nthe builder's account\n\ndepth (meter): would refuse, a finding\n" });

    expect(run().status).toBe(0);
    expect(handed()).toContain("the builder's account");
    expect(handed()).not.toContain("(meter)");
  });

  it("keeps one fingerprint when main is merged in, unchanged by the shift in its own lines, so the merged PR still reuses its last judgement", () => {
    const { before, after } = diffsAcrossMerge();
    expect(before).not.toBe(after);

    const merged = reviewing({ diff: after, onPr: [matchComment(fingerprintOf(before, REVIEWED_TICKET))] });
    expect(merged.run().status).toBe(0);
    expect(merged.hired()).toEqual([]);
    expect(merged.comments()).toEqual([]);
  });
});

const LANDED = "export const parseDoneWhen = (body: string) => body.split(\"## Done when\")[1];";
const matchedAt = (fingerprint: string, main: string) => `${matchComment(fingerprint)}Main: \`${main}\`\n`;

describe("bin/review judges a PR brought up to date against what merged to main since its last judgement (#1016)", () => {
  const diff = fileDiff("src/done-when.ts", "export const doneWhenOf = (body: string) => body.split(\"## Done when\")[1];");

  it("records the main it judged against on a fresh judgement", () => {
    const { run, root, comments } = reviewing({ diff, landed: LANDED });

    expect(run().status).toBe(0);
    expect(comments()[0]).toContain(`Main: \`${git(root, "rev-parse", "origin/main")}\``);
  });

  it("hands the reviewer only the PR and what merged since its last match, and sends each find to the builder as a red judgement", () => {
    const finds = ["src/done-when.ts doneWhenOf does what parseDoneWhen, merged in #800, already does; keep one"];
    const { run, root, hired, handed, comments } = reviewing({ diff, landed: LANDED, onPr: ({ before }) => [matchedAt(fingerprintOf(diff, REVIEWED_TICKET), before)], verdict: { finds } });

    const result = run();

    expect(result.status).toBe(1);
    expect(hired()).not.toEqual([]);
    expect(handed()).toContain(LANDED);
    expect(handed()).toContain("Merge pull request #800");
    expect(handed()).toContain("+export const doneWhenOf");
    expect(handed()).toMatch(/duplicate/i);
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).toContain(finds[0]);
    expect(comments()[0]).toContain(`Main: \`${git(root, "rev-parse", "origin/main")}\``);
    expect(earlierDrift("810", [comments()[0] ?? ""])).toContain(finds[0]);
  });

  it("records a clean second judgement against the new main and stays green, posting no readback", () => {
    const { run, root, comments } = reviewing({ diff, landed: LANDED, onPr: ({ before }) => [matchedAt(fingerprintOf(diff, REVIEWED_TICKET), before)], verdict: { finds: [] } });

    expect(run().status).toBe(0);
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).not.toContain("yes or no");
    expect(comments()[0]).toContain(`Main: \`${git(root, "rev-parse", "origin/main")}\``);
    expect(comments()[0]).toContain(`Fingerprint: \`${fingerprintOf(diff, REVIEWED_TICKET)}\``);
  });

  it("gives no second review when nothing merged to main since its last judgement", () => {
    const { run, hired, comments } = reviewing({ diff, landed: LANDED, onPr: ({ now }) => [matchedAt(fingerprintOf(diff, REVIEWED_TICKET), now)], verdict: { finds: ["should never be asked, nothing merged"] } });

    expect(run().status).toBe(0);
    expect(hired()).toEqual([]);
    expect(comments()).toEqual([]);
  });
});

describe("bin/review runs one review at a time per PR, queued not cancelled (#973)", () => {
  it("runs one review at a time per PR, in a concurrency group keyed on the PR's number that queues rather than cancels, while check and meters stay outside that group", () => {
    const { jobs } = parse(readFileSync(WORKFLOW, "utf8")) as {
      jobs: Record<string, { concurrency?: { group?: string; "cancel-in-progress"?: boolean } }>;
    };
    const review = jobNamed(jobs, "review");
    const check = jobNamed(jobs, "check");
    const meters = jobNamed(jobs, "meters");

    expect(review.concurrency?.group ?? "").toContain("github.event.pull_request.number");
    expect(review.concurrency?.["cancel-in-progress"]).not.toBe(true);
    expect(check.concurrency).toBeUndefined();
    expect(meters.concurrency).toBeUndefined();
  });
});

describe("bin/review writes nothing when the PR moved under it while its model answered (#973)", () => {
  it("writes nothing when the PR moved under it: a diff or ticket whose fingerprint differs from the one it judged posts no judgement, no later finds and no follow-up, and ends green saying a newer run judges the PR", () => {
    const diff = fileDiff("src/reviewer.ts", "export const reviewed = 1;");
    const otherDiff = fileDiff("src/reviewer.ts", "export const reviewed = 2;");

    const diffMoved = reviewing({ diff, diffAfter: otherDiff, verdict: { verdict: "match", gaps: [], readback: "should never be posted, the diff moved" } });
    const diffMovedResult = diffMoved.run();
    expect(diffMovedResult.status).toBe(0);
    expect(diffMoved.hired()).not.toEqual([]);
    expect(diffMoved.comments()).toEqual([]);
    expect(diffMoved.ticketComments()).toEqual([]);
    expect(diffMoved.filed()).toEqual([]);
    expect(diffMovedResult.stdout + diffMovedResult.stderr).toMatch(/newer run judges/i);

    const otherBody = REVIEWED_TICKET.replace("A drift verdict posts every gap", "A drift verdict posts every gap, sorted");
    const ticketMoved = reviewing({ diff, bodyAfter: otherBody, verdict: { verdict: "drift", gaps: ["should never be asked, the ticket moved"] } });
    const ticketMovedResult = ticketMoved.run();
    expect(ticketMovedResult.status).toBe(0);
    expect(ticketMoved.hired()).not.toEqual([]);
    expect(ticketMoved.comments()).toEqual([]);
    expect(ticketMoved.ticketComments()).toEqual([]);
    expect(ticketMoved.filed()).toEqual([]);
    expect(ticketMovedResult.stdout + ticketMovedResult.stderr).toMatch(/newer run judges/i);
  });
});

describe("bin/review posts its judgement when only main moved under it while its model answered (#973)", () => {
  it("posts when only main moved under it: a PR brought up to date with main mid-run, its fingerprint unchanged, posts its judgement as today so the review queued behind it reuses it", () => {
    const { before, after } = diffsAcrossMerge();
    expect(before).not.toBe(after);

    const { run, hired, comments, order } = reviewing({ diff: before, diffAfter: after });
    const result = run();

    expect(result.status).toBe(0);
    expect(hired()).not.toEqual([]);
    expect(order().filter((entry) => entry === "pr diff")).toHaveLength(2);
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).toContain(`Fingerprint: \`${fingerprintOf(before, REVIEWED_TICKET)}\``);
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

describe("bin/review ends red at a GitHub or git read that fails, spending no model and posting nothing (#1112)", () => {
  const LANDED_MAIN = { diff: fileDiff("src/done-when.ts", "export const doneWhenOf = 1;"), landed: LANDED };
  const sinceMatched = { ...LANDED_MAIN, onPr: ({ before }: { before: string }) => [matchedAt(fingerprintOf(LANDED_MAIN.diff, REVIEWED_TICKET), before)] };
  const READS = [
    { read: "the PR's branch", options: { unreadable: '*"pr view"*' }, line: "#9810 could not be read, so nothing read it" },
    { read: "the ticket", options: { unreadable: '*"issue view"*' }, line: "#9810 ended red, ticket #810 could not be read, so no model was spent" },
    { read: "the diff", options: { unreadable: '*"pr diff"*' }, line: "#9810 ended red, its diff could not be read, so no model was spent" },
    { read: "the PR's comments", options: { unreadable: '*"api"*"/comments"*' }, line: "#9810 ended red, the comments on its PR could not be read, so no model was spent" },
    { read: "the ticket's comments", options: { unreadable: '*"issues/810/comments"*' }, line: "#9810 ended red, the comments on #810 could not be read, so no model was spent" },
    { read: "the ticket's spec", options: { unreadable: '*"issues/810/parent"*' }, line: "#9810 ended red, the parent of #810 could not be read, so no model was spent" },
    { read: "the owner's words", options: { body: FOLLOW_UP_TICKET, parent: { ticket: "700" } }, line: "#9810 ended red, the owner's words on #700 could not be read, so no model was spent" },
    { read: "where it stands on main", options: { gitUnreadable: '"merge-base origin/main HEAD"' }, line: "#9810 ended red, where it stands on main could not be read, so no model was spent" },
    { read: "its head", options: { gitUnreadable: '"rev-parse HEAD"' }, line: "#9810 ended red, its head could not be read, so no model was spent" },
    { read: "its fingerprint", options: { gitUnreadable: '"patch-id"*' }, line: "#9810 ended red, the patch id of its diff could not be read, so no model was spent" },
    { read: "the fix's own diff", options: { judged: "merged" as const, gitUnreadable: '"diff "*" HEAD"' }, line: "#9810 ended red, the fix's own diff could not be read, so no model was spent" },
    { read: "what merged since", options: { ...sinceMatched, gitUnreadable: '"log --first-parent"*' }, line: "#9810 ended red, what merged to main since its last judgement could not be read, so no model was spent" },
    { read: "the log directory", options: { gitUnreadable: '*"--git-common-dir"*' }, line: "the log directory could not be named by git, so no model was hired" },
  ];

  it.each(READS)("bin/review ends red at unread naming $read", ({ options, line }) => {
    const { run, spent, comments, ticketComments, filed } = reviewing(options);

    expect(run()).toMatchObject({ status: 1, stderr: `review: ${line}\n` });
    expect(spent()).toBe(false);
    expect([...comments(), ...ticketComments(), ...filed().map(({ body }) => body)]).toEqual([]);
  });
});
