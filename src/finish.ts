import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, NO_EM_DASH, TAIL_CAP, tailOf } from "./brief.ts";
import { CHECK, checkedBy } from "./builder.ts";
import { doneCheck, lastDoneCheck, missesOf } from "./done-checker.ts";
import { askedIssue, commentOnTicket, FOLLOW_UP_OF, gh, ghRead, git, gitRead, heldOn, labelsHeld, mark, OWNER, readOrStop, REVIEW_LET_THROUGH, STUCK, unread } from "./post.ts";
import { approvedOn, COMMIT_WHY, firstTimeNamed, landing, landRefused, ownerStepFiled, reviewedChange, type Routed, ROUTED, ROUTED_REQUIRED, routedFiled, STANDARDS_LOADED, STEPS_ASKED, stuckAsked, TESTS_ARE_YOURS } from "./reviewer.ts";
import { type Progress, progressOn, specBranch } from "./scheduler.ts";
import { sliceTrailed } from "./slice-builder.ts";
import { FINDINGS_CAP } from "./slicer.ts";
import { committed, commitlinted, head, hire, linted, type OwnerStep, OWNER_STEPS, type Spent } from "./stage.ts";
import { SPEC } from "./spelled.ts";
import { stopsOf } from "./stops.ts";
import { quoted, SPEC_CAP } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  unfinishable: "Finish refused: the issue is not labelled `spec`, or its integration branch holds nothing past main",
  unlanded: "Finish: `bin/land` refused the integration branch, and two rounds in a row of its last reviewer changed nothing",
  unchecked: "Finish: the full check stayed red, and two rounds in a row of the reviewer handed it changed nothing",
  reviewerStuck: "Finish: a reviewer answered `stuck`, so the spec is marked `stuck` and the owner is called",
});

const PAST_MAIN = "origin/main..HEAD";
const FROM_MAIN = "origin/main...HEAD";
const COMMITS = "--format=- %h %s%n%n%b";
const UNREAD = "the commits past main could not be read, so nothing was reviewed";
export const SLICE_CAP = 256;
export const BRIEFS_CAP = 16 * 1024;
const ONE_REVIEWER_CAP = 200 * 1024;

const ANSWER = {
  type: "object",
  properties: { outcome: { enum: ["approve", "stuck"] }, reason: { type: "string", pattern: NO_EM_DASH }, steps: OWNER_STEPS, ...ROUTED },
  required: ["outcome", "reason", ...ROUTED_REQUIRED],
  additionalProperties: false,
};
const { steps: _stepsOnTheSpecAlone, ...unstepped } = ANSWER.properties;
const CODE_ANSWER = { ...ANSWER, properties: unstepped };

export interface Changes {
  slice?: string;
  commits: string;
  diff: string;
  stat: string;
}

const UNSLICED = "";
const sliceNamed = (slice: string | undefined) => (slice === undefined ? undefined : slice === UNSLICED ? "the commits naming no slice" : `slice \`${capped(slice, SLICE_CAP)}\``);
const alone = (changes: Changes) => {
  const slice = sliceNamed(changes.slice);
  return slice === undefined
    ? []
    : [
        `The diff is over ${ONE_REVIEWER_CAP} bytes, so each slice has its own reviewer on the code standard, and you review what ${slice} built: the commits and diff below are its alone, one patch per commit. Read the rest of the branch too for code that copies what this slice wrote, such as a helper, a type or a query written twice, and make it one.`,
      ];
};
const NEWEST_FIRST = "Its commits are listed newest first, each with its id: `git show <id>` reads one, and `git log origin/main..HEAD` reads any the list cuts.";
const FIX_PASS =
  "The spec landed on main, and its done check found sentences that did not hold; its findings are under `## The done check's findings`. This is the spec's one fix pass: its integration branch is fresh off main and holds only the fix, built slice by slice, so the rest of the spec is on main already.";
const foundBy = (findings: string | undefined) => (findings === undefined ? [] : ["## The done check's findings", capped(findings, FINDINGS_CAP)]);
const answerAsked = [
  "Answer one outcome:",
  "- `approve`: it holds, with whatever you fixed; once every reviewer approves, `bin/land` runs the full check and merges it, and anything it refuses comes back to the last reviewer.",
  stuckAsked("spec"),
  `${STEPS_ASKED}, since those of your last answer are each filed as an \`owner-step\` note once the spec lands.`,
  "`fixes`: each fault you leave for a later build, at most three, each with one sure fix: `fault` with its evidence, `title`, and `done` as the sentences true once it is fixed; each becomes a ticket the machine builds after the spec lands.",
  "`risks`: any other fault, cost or risk you found, as `risk`, with `ends` naming its end: `fixed` by you here, `why` telling how; `owner`, which only the owner can decide, `why` holding your pick, every reviewer's gathered into one note to the owner once the spec lands; `nothing`, `why` telling why it can stand.",
  "You are done reviewing when each fault, cost or risk you found sits in `fixes` or `risks`; both stay empty only when you found none. Your last answer is the one filed, so it names them all.",
  "`reason`: one paragraph for the owner on what the spec built. Every reviewer's `approve` `reason` is commented on the spec's PR before it merges, and below them each of your `fixes` and `risks` with its end.",
];

export function onTheCode(changes: Changes, { spec, red, commitlint, findings }: { spec: string; red?: string; commitlint: boolean; findings?: string }): string {
  const built = findings === undefined ? "Builders built this spec slice by slice on its integration branch, and a reviewer on the spec has read it and fixed what it missed." : `${FIX_PASS} A reviewer on the spec has read it.`;
  return [
    `# Hold spec #${spec} to the code standard before it lands`,
    `${built} You did not build it: read its commit messages and diff as its reviewer on the code standard.`,
    ...alone(changes),
    ...(red === undefined
      ? []
      : [
          "## Its full check is red",
          `\`${CHECK}\` went red on this branch once the reviewer on the spec was done. The red may sit in any slice's code, and it is yours wherever it sits: make it pass, since the check runs again when you answer and holds you until it passes. The end of its output:`,
          tailOf(red, TAIL_CAP),
        ]),
    ...foundBy(findings),
    NEWEST_FIRST,
    ...reviewedChange(changes.commits, changes.diff, changes.stat),
    ...linted(commitlint),
    "## Fix it",
    `${STANDARDS_LOADED} Where the code breaks the code standard, fix it here yourself: nothing goes back to a builder, and nothing after you but \`bin/land\`'s full check reads it. Done when every file the diff changes meets every rule of \`coding-standards\`, and every new or changed test passes all three of the \`testing\` skill's checks. ${TESTS_ARE_YOURS}`,
    COMMIT_WHY,
    "## Your answer",
    ...answerAsked.filter((line) => !line.startsWith(STEPS_ASKED)),
    "",
  ].join("\n\n");
}

export function onTheSpec(changes: Changes, { spec, title, body, commitlint, briefs, findings }: { spec: string; title: string; body: string; commitlint: boolean; briefs: string; findings?: string }): string {
  const built =
    findings === undefined
      ? "Builders built the spec below slice by slice on its integration branch, each slice to its brief under `## Its slices`. You did not build it: read the spec, the briefs, its commit messages and its diff, over the whole branch, as its reviewer on the spec."
      : `${FIX_PASS} You did not build the fix: read the spec, the fix's slices under \`## Its slices\`, its commit messages and its diff as its reviewer on the spec, and judge whether it makes those sentences hold.`;
  const fix =
    findings === undefined
      ? "Where the branch misses what the spec asks, builds what it rules out of scope, or leaves a sentence under `## I'll know it works when I can` with nothing built that would show it, fix it here yourself: nothing goes back to a builder. Once it lands, a fresh done check tries each of those sentences."
      : "Where the fix leaves a finding's sentence unmet, builds what the spec rules out of scope, or breaks what already landed, fix it here yourself: nothing goes back to a builder. Once it lands, a fresh done check tries each sentence again.";
  return [
    `# Hold spec #${spec} to what it asks before it lands`,
    `${built} A reviewer on the code standard reads the branch after you, your fixes with it.`,
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    "## Its slices",
    "Each slice the slicer cut, with the brief its builder built to:",
    capped(briefs, BRIEFS_CAP) || "(none on record)",
    ...foundBy(findings),
    NEWEST_FIRST,
    ...reviewedChange(changes.commits, changes.diff, changes.stat),
    ...linted(commitlint),
    "## Fix it",
    fix,
    COMMIT_WHY,
    "## Your answer",
    ...answerAsked,
    "",
  ].join("\n\n");
}

const WHOLE_BRANCH = "This refusal covers the whole integration branch, not only your slice: it is yours wherever it sits.";
const stillRedOnReview = (red: string) => ["The full check still ends red after your answer; the last of its output:", tailOf(red, TAIL_CAP), "Make it pass, commit, and answer again.", ""].join("\n\n");

const briefsOf = (progress: Progress) =>
  progress.slices
    .filter(({ fix }) => fix === progress.fixPass)
    .map(({ id, title, why, done }) => `- \`${id}\`: ${title.trim()}\n  Why: ${why.trim()}\n  Done when: ${done.map((sentence) => sentence.trim()).join(" ")}`)
    .join("\n");

const shown = (shas: string[], ...args: string[]) => gitRead(["show", ...args, ...shas], UNREAD);

const wholeBranch = (): Changes => ({ commits: gitRead(["log", COMMITS, PAST_MAIN], UNREAD), diff: gitRead(["diff", FROM_MAIN], UNREAD), stat: gitRead(["diff", "--stat", FROM_MAIN], UNREAD) });

function onTheCodeInParts(): Changes[] {
  const whole = wholeBranch();
  if (Buffer.byteLength(whole.diff) <= ONE_REVIEWER_CAP) return [whole];
  const bySlice = new Map<string, string[]>();
  for (const line of gitRead(["log", "--reverse", "--format=%H%x00%(trailers:key=Slice,valueonly,separator=%x00)", PAST_MAIN], UNREAD).split("\n")) {
    const [sha = "", slice = UNSLICED] = line.split("\0");
    bySlice.set(slice, [...(bySlice.get(slice) ?? []), sha]);
  }
  return [...bySlice]
    .sort(([one], [other]) => Number(one === UNSLICED) - Number(other === UNSLICED))
    .map(([slice, shas]) => ({ slice, commits: shown([...shas].reverse(), "--no-patch", COMMITS), diff: shown(shas, "--format="), stat: shown(shas, "--format=", "--stat") }));
}

interface Reviewer {
  spend: (input: string, resume?: string) => Spent;
  session?: string;
  seat: string;
  on: string;
  slice?: string;
}

interface Finished {
  landed?: string;
  missed?: number[];
}

interface Approved extends Routed {
  reason: string;
  steps: OwnerStep[];
}

interface Reviewed {
  last: Reviewer;
  whole: boolean;
}

interface Run {
  spec: string;
  said: string;
  app: AppKey | undefined;
  reasons: Map<string, string>;
  later: string[];
  left: Map<string, Approved>;
}

function reviewed(spec: string, said: string, spent: Spent, app: AppKey | undefined): Approved | undefined {
  if (app !== undefined) freshAppToken(app, gh, `so the review of #${spec} is not acted on`);
  if (spent.refusal !== undefined) {
    stoppedAt("modelRun", `${said} ended red, ${spent.refusal}`);
    return undefined;
  }
  const answer = spent.answer as ({ outcome?: unknown; reason?: unknown; steps?: OwnerStep[] } & Routed) | undefined;
  const reason = typeof answer?.reason === "string" ? answer.reason.trim() : "";
  if (reason === "") {
    stoppedAt("modelRun", `${said} ended red, its reviewer gave no reason`);
    return undefined;
  }
  if (answer?.outcome === "stuck") {
    mark(spec, STUCK);
    commentOnTicket(spec, `@${OWNER} a reviewer of #${spec} stopped and needs you: ${reason}`, gh);
    stoppedAt("reviewerStuck", `${said} marked ${STUCK}, ${reason}`);
    return undefined;
  }
  return { reason, steps: answer?.steps ?? [], fixes: answer?.fixes, risks: answer?.risks };
}

const pushedForRerun = (spec: string) => gitRead(["push", "--quiet", "--force", "origin", `HEAD:refs/heads/${specBranch(spec)}`], `${specBranch(spec)} would not push, so a rerun would lose its reviewers' fixes`);

function answered({ spec, said, app, left }: Run, reviewer: Reviewer, input: string, commit: string): Approved | undefined {
  const before = head();
  const spent = reviewer.spend(input, reviewer.session);
  reviewer.session = spent.session ?? reviewer.session;
  const approved = reviewed(spec, said, spent, app);
  if (approved === undefined) return undefined;
  committed(commit, "fix");
  if (reviewer.slice !== undefined && reviewer.slice !== UNSLICED && git(["merge-base", "--is-ancestor", before, "HEAD"]).status === 0) sliceTrailed(before, reviewer.slice);
  pushedForRerun(spec);
  left.set(reviewer.seat, approved);
  return approved;
}

type Round<Done> = { done: Done } | { refused: string; told: string };

function rounds<Done>(run: Run, reviewer: Reviewer, { failed, stop, commit, kept }: { failed: string; stop: "unlanded" | "unchecked"; commit: string; kept: (approved: Approved) => void }, attempt: () => Round<Done>): Done | undefined {
  let idle = false;
  const later: string[] = [];
  for (;;) {
    const tried = attempt();
    if ("done" in tried) return tried.done;
    const before = head();
    const approved = answered(run, reviewer, tried.told, commit);
    if (approved === undefined) return undefined;
    kept(approved);
    const changed = head() !== before;
    if (!changed && idle) {
      stoppedAt(stop, `${run.said} ${failed}, and two rounds in a row of its reviewer changed nothing: ${quoted(tried.refused.split("\n").at(-1) ?? "")}`);
      return undefined;
    }
    idle = !changed;
  }
}

const greened = (run: Run, reviewer: Reviewer, commit: string) =>
  rounds(run, reviewer, { failed: "stayed red on its full check", stop: "unchecked", commit, kept: (approved) => run.reasons.set(reviewer.seat, `${reviewer.on}: ${approved.reason}`) }, () => {
    const red = checkedBy(CHECK);
    return red === undefined ? { done: true } : { refused: red, told: stillRedOnReview(red) };
  });

function told(run: Run, reviewer: Reviewer, input: string, commit: string): Approved | undefined {
  const approved = answered(run, reviewer, input, commit);
  if (approved !== undefined) run.reasons.set(reviewer.seat, `${reviewer.on}: ${approved.reason}`);
  return approved;
}

function reviews(run: Run, { title, body }: { title: string; body: string }): Reviewed | undefined {
  const { spec } = run;
  const commitlint = commitlinted();
  const { progress } = progressOn(spec);
  const findings = progress.fixPass ? missesOf(lastDoneCheck(spec, `the comments on #${spec} could not be read, so nothing was reviewed`) ?? "") : undefined;
  const reviewer = (seat: string, on: "spec" | "code standard", answers: object, slice?: string): Reviewer => ({
    spend: hire("finish", seat, { name: `reviewer on the ${on}`, model: "opus", answers }),
    seat,
    on: `On the ${on}${slice === undefined ? "" : `, ${sliceNamed(slice)}`}`,
    slice,
  });
  const onSpec = reviewer(`${spec}-spec`, "spec", ANSWER);
  const approved = told(run, onSpec, onTheSpec(wholeBranch(), { spec, title, body, commitlint, briefs: briefsOf(progress), findings }), `Review #${spec} on the spec`);
  if (approved === undefined) return undefined;
  let red = checkedBy(CHECK);
  const parts = onTheCodeInParts();
  let last = onSpec;
  for (const [at, changes] of parts.entries()) {
    const onCode = reviewer(`${spec}-code-${at + 1}`, "code standard", CODE_ANSWER, changes.slice);
    const commit = `Review #${spec} on the code standard`;
    if (told(run, onCode, onTheCode(changes, { spec, red, commitlint, findings }), commit) === undefined) return undefined;
    if (red !== undefined && greened(run, onCode, commit) === undefined) return undefined;
    red = undefined;
    last = onCode;
  }
  return { last, whole: parts.length === 1 };
}

function landed(run: Run, { last, whole }: Reviewed): string | undefined {
  const { spec, said, reasons, later, left } = run;
  return rounds(run, last, { failed: "did not land", stop: "unlanded", commit: `Fix what bin/land refused for #${spec}`, kept: (approved) => later.push(approved.reason) }, (): Round<string | undefined> => {
    const held = heldOn(labelsHeld(spec, gh));
    if (held !== undefined) {
      console.log(`${said} is marked ${held}, so its reviewed branch does not land`);
      return { done: undefined };
    }
    const attempt = landing(["--spec", spec], approvedOn([...reasons.values()], later, [...left.values()]));
    if ("pr" in attempt) return { done: attempt.pr };
    return { refused: attempt.refused, told: whole ? landRefused(attempt.refused) : [WHOLE_BRANCH, landRefused(attempt.refused)].join("\n\n") };
  });
}

function leftFiled(spec: string, approved: Approved[]): void {
  const unfiled = firstTimeNamed();
  const once = approved.flatMap(({ steps }) => steps).filter(({ title }) => unfiled(title));
  const filed = [...once.map(ownerStepFiled(`Left to the owner by the run that landed spec #${spec}.`)), ...routedFiled(`${FOLLOW_UP_OF}${spec}${REVIEW_LET_THROUGH}`, approved, { title: `Your call after spec #${spec}'s review`, by: `the review of spec #${spec}` })];
  const refused = filed.filter(({ refusals }) => refusals.length > 0);
  if (refused.length > 0) commentOnTicket(spec, [`What the reviewers of #${spec} left that could not be filed:`, "", ...refused.map(({ named, refusals }) => `- ${named} (${quoted(refusals[0] ?? "")})`), ""].join("\n"), gh);
}

function finished(spec: string, app: AppKey | undefined): Finished {
  const said = `finish: #${spec}`;
  const unchanged = "so nothing was reviewed or landed";
  const asked = askedIssue(ghRead(["issue", "view", spec, "--json", "title,body,labels"], `#${spec} could not be read, ${unchanged}`)) ?? unread(`#${spec} could not be read, ${unchanged}`);
  if (!asked.labels.has(SPEC)) {
    stoppedAt("unfinishable", `${said} is not a spec, ${unchanged}`);
    return {};
  }
  const held = heldOn(asked.labels);
  if (held !== undefined) {
    console.log(`${said} is marked ${held}, ${unchanged}`);
    return {};
  }
  if (gitRead(["rev-list", "--count", PAST_MAIN], UNREAD) === "0") {
    stoppedAt("unfinishable", `${said} holds nothing past main on its integration branch, ${unchanged}`);
    return {};
  }
  const run: Run = { spec, said, app, reasons: new Map(), later: [], left: new Map() };
  const review = reviews(run, asked);
  if (review === undefined) return {};
  const pr = landed(run, review);
  if (pr === undefined) return {};
  leftFiled(spec, [...run.left.values()]);
  const checked = readOrStop("done-check", () => doneCheck(spec, app));
  return { landed: pr, missed: typeof checked === "object" ? checked.missed : undefined };
}

if (import.meta.main) {
  const [spec] = process.argv.slice(2);
  if (spec === undefined) throw new Error("no spec number in the arguments");
  const ended = readOrStop("finish", () => finished(spec, takenAppKey()));
  const { landed: pr = "", missed } = typeof ended === "object" ? ended : {};
  console.log(`landed=${pr}\nmissed=${(missed ?? []).join(",")}`);
  process.exit(pr !== "" && missed !== undefined ? 0 : 1);
}
