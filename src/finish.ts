import { waitedForAccounts } from "./account-wait.ts";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { join } from "node:path";
import { capped, diffOverCap, LIST_CAP, listedCapped, NO_EM_DASH, onDisk, TAIL_CAP, tailOf } from "./brief.ts";
import { checkedBy, type Red, machineFault } from "./builder.ts";
import { PUBLISHED_CHECK } from "./checks.ts";
import { type Answered, approvedOn, filed, type FollowUps, gathered, MOST_FIXES, OWNER_STEPS, ROUTED, ROUTED_REQUIRED, STEP_TRAILER, stepsUnfileable } from "./follow-ups.ts";
import { postedUnderOrigin } from "./issue-links.ts";
import { askedOn, calledOwner, commentOnTicket, endedRed, followUpBody, fromHere, fromLine, gh, gitRead, standingOn, stoodDown, mark, readOrStop, STUCK } from "./post.ts";
import { afterRefused, landing } from "./reviewer.ts";
import { landedOn, type LineAnswer, type Progress, progressOn, specBranch } from "./scheduler.ts";
import { freePort, isolated, reapedUnder } from "./slice-builder.ts";
import { type Ahead, committed, commitlinted, CONTRACT, head, hireIn, type Looped, setupRefusedIn, type Spent, stageLoop, type Stop, unsetKeys, WRITE_UP_MINUTES } from "./stage.ts";
import { CHECKING, SPEC } from "./spelled.ts";
import { closingLines, quoted, SPEC_CAP } from "./ticket-shape.ts";

const PAST_MAIN = "origin/main..HEAD";
const FROM_MAIN = "origin/main...HEAD";
const COMMITS = "--format=- %h %s%n%n%b";
const STEPS_NAMED = `--format=%(trailers:key=${STEP_TRAILER},valueonly,unfold)`;
const UNREAD = "the commits past main could not be read, so nothing was reviewed";
export const BRIEFS_CAP = 16 * 1024;
export const ONE_REVIEWER_CAP = 200 * 1024;

const OUTCOMES = { held: "Held", fixed: "Fixed before it landed", missed: "Did not hold", unrun: "Not run" } as const satisfies Record<LineAnswer["outcome"], string>;

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["approve", "stuck"] },
    reason: { type: "string", pattern: NO_EM_DASH },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { line: { type: "integer", minimum: 1 }, outcome: { enum: Object.keys(OUTCOMES) }, ran: { type: "string", pattern: NO_EM_DASH } },
        required: ["line", "outcome", "ran"],
        additionalProperties: false,
      },
    },
    steps: OWNER_STEPS,
    ...ROUTED,
  },
  required: ["outcome", "reason", "lines", ...ROUTED_REQUIRED],
  additionalProperties: false,
};

export interface Changes {
  commits: string;
  ownerSteps: string;
  diff: string;
  stat: string;
}

const diffHanded = ({ diff, stat }: Changes) => {
  const over = diffOverCap(diff, stat, ONE_REVIEWER_CAP);
  return over === undefined
    ? diff
    : [`The diff is ${over.bytes} bytes, over ${ONE_REVIEWER_CAP}, so only its \`git diff --stat\` and its files are handed; read in the repo what you need of it.`, over.stat, "Every file changed:", over.files].join("\n\n");
};

const numbered = (closing: string[]) => closing.map((line, at): [number, string] => [at + 1, line]);
const listed = (lines: [number, string][]) => capped(lines.map(([number, line]) => `${number}. ${line}`).join("\n"), SPEC_CAP);

export function onTheBranch(changes: Changes, { spec, title, body, closing, commitlint, briefs, unset }: { spec: string; title: string; body: string; closing: string[]; commitlint: boolean; briefs: string; unset: string[] }): string {
  return [
    `# Hold spec #${spec} to what it asks and to the code standard before it lands`,
    "Builders built the spec below slice by slice on its integration branch, each slice to its brief under `## Its slices`. You did not build it: read the spec, the briefs, its commit messages and its diff, over the whole branch, as its reviewer. Nothing goes back to a builder.",
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    "## Its slices",
    "Each slice the slicer cut, with the brief its builder built to:",
    capped(briefs, BRIEFS_CAP) || "(none on record)",
    "## Commits",
    "Its commits are listed newest first, each with its id: `git show <id>` reads one, and `git log origin/main..HEAD` reads any the list cuts.",
    capped(changes.commits, LIST_CAP),
    ...(changes.ownerSteps === "" ? [] : ["## Owner steps its builders named", "A slice's builder built around each of these and left it to you: put every one that still stands in `steps`.", capped(changes.ownerSteps, LIST_CAP)]),
    "## Diff from main",
    diffHanded(changes),
    ...(commitlint ? ["commitlint checks each commit here: a message reads `type: subject`, with a conventional type such as `fix` or `feat` and a lower-case subject."] : []),
    "## Done when",
    listed(numbered(closing)),
    "Confirm each line under `## Done when` is done. Its tests already pass, and you are the only one who runs it before it lands. Where a line is not true, make it true here. Do only what is necessary: the spec waits on you to land. The tree, port and Postgres are yours alone.",
    ...(unset.length === 0 ? [] : [`The repo's contract names ${listedCapped(unset.map((key) => `\`${key}\``))}, which its secrets lack, so this run has none of them: a line resting on one is \`unrun\`, its \`ran\` naming the key.`]),
    "The full check runs once you answer, and a red comes back to you until it is green, so run the tests of what you change and leave `check --full` to that run. The fast check still runs on each commit you make.",
    "## Fix it",
    "First call the Skill tool with `coding-standards` and then with `testing`: they hold the code standard and the test standard you judge the branch by and build to.",
    "The spec: where the branch misses what it asks, builds what it rules out of scope, or leaves any story short of whole, build the rest here yourself.",
    "The code: where it breaks either standard, fix it here. It is done when every file the diff changes meets every rule of `coding-standards`, and every new or changed test passes the `testing` skill's checks.",
    "Every change you make goes in a commit whose message gives the reason, using neither an em dash nor an issue-closing word like `Closes #12`.",
    "## Your answer",
    "Answer one outcome:",
    "- `approve`: the branch builds what the spec asks and its code meets the standard, with whatever you fixed; the full check then runs and `bin/land` merges the spec.",
    "- `stuck`: the machine itself is at fault and you cannot go on; `reason` says why, and the spec is marked `stuck`.",
    "`lines`: one entry per line under `## Done when`, `line` its number there and `ran` what you ran and saw. `outcome`: `held`; `fixed`, once you made it true here; `missed` where you could not, `ran` saying what you ran and where it broke, since that becomes the bug filed once the spec lands; `unrun` where nothing here can run it, `ran` saying what is missing here.",
    "`steps`: what needs the owner's own login, money or identity before the spec's work can run, once no tool here can do it; each one named becomes an `owner-step` note once the spec lands. A fix that cannot build until the owner takes a step gives that step's exact title in `waits`, and builds once its note closes.",
    `\`fixes\`: each fault that belongs in another repo, or in code the spec never touched and is too big to fix here, at most ${MOST_FIXES}, each with one sure fix: \`fault\` and the evidence for it, \`title\`, and \`done\`, the sentences that will be true after the fix; each becomes a ticket the machine builds after the spec lands.`,
    "`risks`: any other fault, cost or risk you found, as `risk`, with `ends` naming its end: `fixed` by you here, `why` telling how; `nothing`, `why` telling why it can stand. Each choice the spec or the code leaves open is yours to make as its senior engineer: build your pick here and name it in `reason`, where the owner can overrule it. Only `steps` reach the owner.",
    "You are done reviewing when each fault, cost or risk you found sits in `fixes` or `risks`; both stay empty only when you found none. Nothing named in an earlier answer is dropped: a later one names only the findings it adds and those whose end it changes.",
    "`reason`: a paragraph telling the owner what the spec built and how its code holds to the standard. Your `approve` `reason` is commented on the spec's PR before it merges, and below it each of your `fixes` and `risks` with its end.",
    "",
  ].join("\n\n");
}

export const OUT_OF_TIME = "Time is up on this spec. Stop running and fixing, commit what holds, and answer now: each line under `## Done when` you did not reach is `unrun`, its `ran` saying what was left.\n";

const redOnReview = ({ verdict, failed }: Red) =>
  [`The full check ran on the reviewed branch and ended red: \`${verdict}\`. The end of each red step's part of its log:`, tailOf(failed, TAIL_CAP), "Make it pass, commit, and answer again: it runs again on each answer and holds the spec until it is green.", ""].join("\n\n");
const landRefused = (refused: string) =>
  [
    "`bin/land` refused to land the spec. What it said:",
    refused,
    "Fix what it names, commit, and answer again. Where the branch conflicts with `origin/main`, as on migrations main took while it built, rebuild it in this tree on `origin/main` instead, such as one squashed commit with the migrations renumbered after main's: a head built on `origin/main` becomes the integration branch whole.",
  ].join("\n\n");

const briefsOf = (progress: Progress) =>
  progress.slices
    .map(({ id, title, why, done }) => `- \`${id}\`: ${title.trim()}\n  Why: ${why.trim()}\n  Done when: ${done.map((sentence) => sentence.trim()).join(" ")}`)
    .join("\n");

const stepsNamed = () =>
  gitRead(["log", STEPS_NAMED, PAST_MAIN], UNREAD)
    .split("\n")
    .filter((step) => step.trim() !== "")
    .map((step) => `- ${step.trim()}`)
    .join("\n");

const wholeBranch = (): Changes => ({ commits: gitRead(["log", COMMITS, PAST_MAIN], UNREAD), ownerSteps: stepsNamed(), diff: gitRead(["diff", FROM_MAIN], UNREAD), stat: gitRead(["diff", "--stat", FROM_MAIN], UNREAD) });

interface Reviewer {
  spend: (input: string, resume?: string) => Promise<Spent>;
  session?: string | undefined;
}

interface Finished {
  landed?: string | undefined;
  missed?: number[] | undefined;
}

interface Approved extends Answered {
  reason: string;
  lines: LineAnswer[];
}

interface Run {
  spec: string;
  said: string;
  app: AppKey | undefined;
  closing: string[];
  reasons: string[];
  followUps: FollowUps;
  lines: LineAnswer[];
}

const latestPerLine = (...answers: LineAnswer[][]) => [...new Map(answers.flat().map((one) => [one.line, one])).values()];

function reviewed({ spec, said, app }: Run, spent: Spent): Approved | undefined {
  if (app !== undefined) freshAppToken(app, gh, `so the review of #${spec} is not acted on`);
  if (spent.accountsBack !== undefined) {
    waitedForAccounts(spec, { who: "a reviewer", said: `${said} marked ${STUCK}` }, spent.accountsBack);
    return undefined;
  }
  if (spent.refusal !== undefined) {
    endedRed(`${said} ended red, ${spent.refusal}`);
    return undefined;
  }
  const answer = spent.answer as ({ outcome?: unknown; reason?: unknown; lines?: LineAnswer[] } & Answered) | undefined;
  const reason = typeof answer?.reason === "string" ? answer.reason.trim() : "";
  if (reason === "") {
    endedRed(`${said} ended red, its reviewer gave no reason`);
    return undefined;
  }
  if (answer?.outcome === "stuck") {
    calledOwner(spec, { who: "a reviewer", said: `${said} marked ${STUCK}` }, reason);
    return undefined;
  }
  return { reason, steps: answer?.steps, fixes: answer?.fixes, risks: answer?.risks, lines: answer?.lines ?? [] };
}

const pushedForRerun = (spec: string) => gitRead(["push", "--quiet", "--force", "origin", `HEAD:refs/heads/${specBranch(spec)}`], `${specBranch(spec)} would not push, so a rerun would lose its reviewer's fixes`);

function settled(run: Run, reviewer: Reviewer, spent: Spent, commit: string): Approved | undefined {
  reviewer.session = spent.session ?? reviewer.session;
  committed(commit, "fix");
  pushedForRerun(run.spec);
  const approved = reviewed(run, spent);
  if (approved === undefined) return undefined;
  run.followUps = gathered(run.followUps, approved);
  run.lines = latestPerLine(run.lines, approved.lines);
  return approved;
}

function reviewerLoop<Done>(run: Run, reviewer: Reviewer, { stops, commit, kept }: { stops: readonly Stop[]; commit: string; kept?: ((approved: Approved) => void) | undefined }, ahead: () => Ahead<Done> | Promise<Ahead<Done>>): Promise<Looped<Done | undefined>> {
  let before = "";
  return stageLoop<Done | undefined>({
    spend: (handed, resume) => {
      before = head();
      return reviewer.spend(handed, resume);
    },
    session: reviewer.session,
    stops,
    ahead,
    judged: (spent) => {
      const approved = settled(run, reviewer, spent, commit);
      if (approved === undefined) return { done: undefined };
      kept?.(approved);
      return { changed: head() !== before };
    },
  });
}

async function rounds<Done>(run: Run, reviewer: Reviewer, { failed, commit, kept }: { failed: string; commit: string; kept: (approved: Approved) => void }, attempt: () => Ahead<Done> | Promise<Ahead<Done>>): Promise<Done | undefined> {
  const looped = await reviewerLoop(run, reviewer, { stops: ["unchanged"], commit, kept }, attempt);
  if ("done" in looped) return looped.done;
  endedRed(`${run.said} ${failed}, and two rounds in a row of its reviewer changed nothing: ${quoted(looped.refused.split("\n").at(-1) ?? "")}`);
  return undefined;
}

function stoppedByMachine({ spec, said }: Run, red: Red | undefined): boolean {
  const fault = machineFault(red);
  if (fault === undefined) return false;
  calledOwner(spec, { who: "the finisher", said: `${said} marked ${STUCK}` }, fault);
  return true;
}

const greened = (run: Run, reviewer: Reviewer, commit: string) =>
  rounds(run, reviewer, { failed: "stayed red on its full check", commit, kept: (approved) => run.reasons.push(`After its full check went red: ${approved.reason}`) }, async () => {
    const red = await checkedBy(PUBLISHED_CHECK);
    if (stoppedByMachine(run, red)) return { done: undefined };
    return red === undefined ? { done: true } : { refused: red.verdict, handBack: redOnReview(red) };
  });

function linesUnanswered({ closing, lines }: Run): string | undefined {
  const unanswered = numbered(closing).filter(([number]) => !lines.some(({ line }) => line === number));
  return unanswered.length === 0 ? undefined : ["Your `lines` give no entry for these lines under `## Done when`:", listed(unanswered), "Answer again with one for each: nothing lands until every line has its entry."].join("\n\n");
}

async function answeredWhole(run: Run, reviewer: Reviewer, commit: string): Promise<boolean> {
  const looped = await reviewerLoop(run, reviewer, { stops: ["again"], commit }, () => {
    const refused = stepsUnfileable(run.followUps.steps) ?? linesUnanswered(run);
    return refused === undefined ? { done: true } : { refused, handBack: refused };
  });
  if ("done" in looped) return looped.done === true;
  endedRed(`${run.said} landed nothing, its reviewer gave the same refused answer again: ${looped.refused}`);
  return false;
}

async function reviewerHired({ spec, said }: Run): Promise<Reviewer | undefined> {
  const tree = process.cwd();
  const isolation = await isolated(tree, [spec, "finish"], await freePort());
  const unready = typeof isolation === "string" ? isolation : await setupRefusedIn(tree, onDisk(join(tree, CONTRACT)) ?? "", { ...isolation });
  if (typeof isolation === "string" || unready !== undefined) {
    endedRed(`${said} ended red, the tree for ${specBranch(spec)} would not set up: ${unready}`);
    return undefined;
  }
  const spend = hireIn(tree, "finish", spec, { name: "reviewer", model: "opus", effort: "medium", answers: ANSWER, writeUp: { minutes: WRITE_UP_MINUTES, told: OUT_OF_TIME } }, { ...isolation });
  return { spend: (input, resume) => spend(input, resume).finally(() => reapedUnder([isolation.TMPDIR])) };
}

async function reviewedBy(run: Run, { title, body }: { title: string; body: string }, progress: Progress): Promise<Reviewer | undefined> {
  const { spec, closing } = run;
  const reviewer = await reviewerHired(run);
  if (reviewer === undefined) return undefined;
  const commit = `Review #${spec}`;
  const opening = onTheBranch(wholeBranch(), { spec, title, body, closing, commitlint: commitlinted(), briefs: briefsOf(progress), unset: unsetKeys() });
  const approved = settled(run, reviewer, await reviewer.spend(opening), commit);
  if (approved === undefined || !(await answeredWhole(run, reviewer, commit))) return undefined;
  run.reasons.push(approved.reason);
  return (await greened(run, reviewer, commit)) === undefined ? undefined : reviewer;
}

function landed(run: Run, reviewer: Reviewer): Promise<string | undefined> {
  const { spec, said, reasons } = run;
  return rounds(run, reviewer, { failed: "did not land", commit: `Fix what bin/land refused for #${spec}`, kept: (approved) => reasons.push(afterRefused(approved.reason)) }, (): Ahead<string | undefined> => {
    const stood = stoodDown(standingOn(spec, gh));
    if (stood !== undefined) {
      console.log(`${said} ${stood}, so its reviewed branch does not land`);
      return { done: undefined };
    }
    const attempt = landing(["--spec", spec], approvedOn(reasons, run.followUps));
    if ("pr" in attempt) return { done: attempt.pr };
    return { refused: attempt.refused, handBack: landRefused(attempt.refused) };
  });
}

function leftFiled(spec: string, followUps: FollowUps): void {
  const refused = filed(followUps, { found: fromLine(fromHere(spec), "review"), left: `Left to the owner by the run that landed spec #${spec}.` }).filter(({ refusals }) => refusals.length > 0);
  if (refused.length > 0) commentOnTicket(spec, [`What the reviewer of #${spec} left that could not be filed:`, "", ...refused.map(({ named, refusals }) => `- ${named} (${quoted(refusals[0] ?? "")})`), ""].join("\n"), gh);
}

const CLOSING_HEADING = "## Done when";
const UNRECORDED = "no outcome was recorded for it before the spec landed";

function closed({ spec, said }: Pick<Run, "spec" | "said">, closing: string[], lines: LineAnswer[]): number[] | number {
  const stopped = (why: string, follows: string) => calledOwner(spec, { who: "the finisher", said: `${said} marked ${STUCK}` }, why, follows);
  const found = numbered(closing).map(([line, text]) => ({ text, ...(lines.find((one) => one.line === line) ?? { line, outcome: "unrun" as const, ran: UNRECORDED }) }));
  const comment = commentOnTicket(spec, [CLOSING_HEADING, "", ...found.map(({ line, text, outcome, ran }) => `${line}. **${OUTCOMES[outcome]}**: ${text}\n   ${ran}`), ""].join("\n"), gh);
  const [unposted] = comment.refusals;
  if (unposted !== undefined) return stopped(`it landed, and its closing comment would not post: ${quoted(unposted)}`, `Nothing was posted or filed: once its cause is fixed, take \`${STUCK}\` off and its run closes it from the lines its progress comment recorded.`);
  const missed = found.filter(({ outcome }) => outcome === "missed");
  const bugs = missed.map(({ line, text, ran }) => ({ line, ...postedUnderOrigin({ kind: "bug", title: quoted(text), text: followUpBody([fromLine(fromHere(spec), "review"), "", `> ${ran}`], [text]) }, gh) }));
  const unfiled = bugs.find(({ refusals }) => refusals.length > 0);
  if (unfiled !== undefined) return stopped(`it landed, and line ${unfiled.line} would not file: ${quoted(unfiled.refusals[0] ?? "")}`, `Its comment is posted: file each miss as a bug, and close #${spec} by hand.`);
  const filedAs = missed.length === 0 ? "" : `, with line ${missed.map(({ line }) => line).join(", ")} filed as ${bugs.map((bug) => bug.said.trim()).join(", ")}`;
  if (gh(["issue", "close", spec, "--reason", "completed"]).status !== 0) return stopped(`it landed${filedAs}, and would not close: ${comment.said}`, `Its comment is posted, so nothing is left to file: close #${spec} by hand.`);
  console.log(`${said} landed and is closed${filedAs}: ${comment.said}`);
  return missed.map(({ line }) => line);
}

async function closedAfter(run: Pick<Run, "spec" | "said" | "app">, closing: string[], lines: LineAnswer[], pr: string): Promise<Finished> {
  const missed = await readOrStop("finish", () => {
    if (run.app !== undefined) freshAppToken(run.app, gh, `so #${run.spec} is not closed`);
    return closed(run, closing, lines);
  });
  return { landed: pr, missed: typeof missed === "object" ? missed : undefined };
}

async function finished(spec: string, app: AppKey | undefined): Promise<Finished> {
  const said = `finish: #${spec}`;
  const unchanged = "so nothing was reviewed or landed";
  const asked = askedOn(spec, unchanged);
  if (!asked.labels.has(SPEC)) {
    endedRed(`${said} is not a spec, ${unchanged}`);
    return {};
  }
  const stood = stoodDown(asked);
  if (stood !== undefined) {
    console.log(`${said} ${stood}, ${unchanged}`);
    return {};
  }
  const found = progressOn(spec);
  const closing = closingLines(asked.body);
  const { landed: landedAs, lines: recorded = [] } = found.progress;
  if (landedAs === undefined && gitRead(["rev-list", "--count", PAST_MAIN], UNREAD) === "0") {
    endedRed(`${said} holds nothing past main on its integration branch, ${unchanged}`);
    return {};
  }
  mark(spec, CHECKING);
  if (landedAs !== undefined) return closedAfter({ spec, said, app }, closing, recorded, landedAs);
  const run: Run = { spec, said, app, closing, reasons: [], followUps: gathered(), lines: [] };
  const reviewer = await reviewedBy(run, asked, found.progress);
  if (reviewer === undefined) return {};
  const pr = await landed(run, reviewer);
  if (pr === undefined) return {};
  landedOn(spec, found, pr, run.lines);
  leftFiled(spec, run.followUps);
  return closedAfter(run, closing, run.lines, pr);
}

if (import.meta.main) {
  const [spec] = process.argv.slice(2);
  if (spec === undefined) throw new Error("no spec number in the arguments");
  const ended = await readOrStop("finish", () => finished(spec, takenAppKey()));
  const { landed: pr = "", missed } = typeof ended === "object" ? ended : {};
  console.log(`landed=${pr}\nmissed=${(missed ?? []).join(",")}`);
  process.exit(pr !== "" && missed !== undefined ? 0 : 1);
}
