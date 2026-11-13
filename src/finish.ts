import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capped, diffOverCap, LIST_CAP, listedCapped, NO_EM_DASH, onDisk, TAIL_CAP, tailOf } from "./brief.ts";
import { checkedBy, type Red, machineFault } from "./builder.ts";
import { PUBLISHED_CHECK } from "./checks.ts";
import { type Checked, doneCheck, doneCheckCalledOwner, paired, postedOn, triedIn, type Try } from "./done-checker.ts";
import { askedOn, calledOwner, commentOnTicket, endedRed, fromHere, fromLine, gh, git, gitRead, standingOn, stoodDown, mark, readOrStop, STUCK, Stopped, unread } from "./post.ts";
import { type Answered, approvedOn, filed, type FollowUps, gathered, MOST_FIXES, type OwnerStep, OWNER_STEPS, ROUTED, ROUTED_REQUIRED, stepsUnfileable } from "./follow-ups.ts";
import { afterRefused, landing } from "./reviewer.ts";
import { fastForwarded, landedOn, MOST_BUILDERS, type Progress, progressOn, removed, specBranch, triedOn, worktree } from "./scheduler.ts";
import { fastForwards, rebaseStopped, sliceTrailed } from "./slice-builder.ts";
import { type Ahead, committed, commitlinted, CONTRACT, head, hireIn, type Looped, type Refusal, setupRefusedIn, type Spent, stageLoop, type Stop } from "./stage.ts";
import { CHECKING, SPEC } from "./spelled.ts";
import { quoted, type Sentence, sentences, SPEC_CAP } from "./ticket-shape.ts";

const PAST_MAIN = "origin/main..HEAD";
const FROM_MAIN = "origin/main...HEAD";
const COMMITS = "--format=- %h %s%n%n%b";
const UNREAD = "the commits past main could not be read, so nothing was reviewed";
export const SLICE_CAP = 256;
export const BRIEFS_CAP = 16 * 1024;
export const ONE_REVIEWER_CAP = 200 * 1024;

const ANSWER = {
  type: "object",
  properties: { outcome: { enum: ["approve", "stuck"] }, reason: { type: "string", pattern: NO_EM_DASH }, steps: OWNER_STEPS, fixed: { type: "array", items: { type: "integer", minimum: 1 } }, ...ROUTED },
  required: ["outcome", "reason", ...ROUTED_REQUIRED],
  additionalProperties: false,
};

export interface Changes {
  slices?: string[] | undefined;
  commits: string;
  diff: string;
  stat: string;
}

const UNSLICED = "";
const sliceNamed = (slice: string) => (slice === UNSLICED ? "the commits naming no slice" : `slice \`${capped(slice, SLICE_CAP)}\``);
const slicesNamed = (slices: string[]) => listedCapped(slices.map(sliceNamed));

const diffHanded = ({ diff, stat }: Changes) => {
  const over = diffOverCap(diff, stat, ONE_REVIEWER_CAP);
  return over === undefined
    ? diff
    : [`The diff is ${over.bytes} bytes, over ${ONE_REVIEWER_CAP}, so only its \`git diff --stat\` and its files are handed; read in the repo what you need of it.`, over.stat, "Every file changed:", over.files].join("\n\n");
};

const inPacks = ({ slices }: Changes) =>
  slices === undefined
    ? []
    : [
        `At over ${ONE_REVIEWER_CAP} bytes the branch is split for review into whole slices packed under that cap, each pack with its own reviewer handed the whole spec and every brief: the commits and diff below are what ${slicesNamed(slices)} built, one patch per commit. Judge the spec over the whole branch all the same, reading the other slices' code in the repo where a story crosses into it, and build here what is missing. Read the rest of the branch too for code that copies what ${slices.length === 1 ? "this slice" : "these slices"} wrote, such as a helper, a type or a query written twice, and make it one.`,
        "The other packs' reviewers work beside you, each in its own tree on its own branch, and your commits are rebased onto the integration branch once you answer; a conflict comes back to you. A red full check, the done check's misses and what `bin/land` refuses go to one of you, for the whole branch.",
      ];

export function onTheBranch(changes: Changes, { spec, title, body, commitlint, briefs }: { spec: string; title: string; body: string; commitlint: boolean; briefs: string }): string {
  return [
    `# Hold spec #${spec} to what it asks and to the code standard before it lands`,
    "Builders built the spec below slice by slice on its integration branch, each slice to its brief under `## Its slices`. You did not build it: read the spec, the briefs, its commit messages and its diff, over the whole branch, as its reviewer. Nothing goes back to a builder.",
    ...inPacks(changes),
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    "## Its slices",
    "Each slice the slicer cut, with the brief its builder built to:",
    capped(briefs, BRIEFS_CAP) || "(none on record)",
    "## Commits",
    "Its commits are listed newest first, each with its id: `git show <id>` reads one, and `git log origin/main..HEAD` reads any the list cuts.",
    capped(changes.commits, LIST_CAP),
    "## Diff from main",
    diffHanded(changes),
    ...(commitlint ? ["commitlint checks each commit here: a message reads `type: subject`, with a conventional type such as `fix` or `feat` and a lower-case subject."] : []),
    "## What runs beside you",
    "A done check started when you did: in its own tree, on the branch as the builders left it, it is trying each story and each sentence under `## I'll know it works when I can` on the running app. What it misses comes back to you once, after you answer, so read the code and leave driving the app in a browser to it.",
    "The full check runs once you answer, and a red comes back to you until it is green, so run the tests of what you change and leave `check --full` to that run. The fast check still runs on each commit you make.",
    "## Fix it",
    "First call the Skill tool with `coding-standards` and then with `testing`: they hold the code standard and the test standard you judge the branch by and build to.",
    "The spec: where the branch misses what it asks, builds what it rules out of scope, or leaves any story or any sentence under `## I'll know it works when I can` short of whole, build the rest here yourself.",
    "The code: where it breaks either standard, fix it here. It is done when every file the diff changes meets every rule of `coding-standards`, and every new or changed test passes the `testing` skill's checks.",
    "Every change you make goes in a commit whose message gives the reason, using neither an em dash nor an issue-closing word like `Closes #12`.",
    "## Your answer",
    "Answer one outcome:",
    "- `approve`: the branch builds what the spec asks and its code meets the standard, with whatever you fixed; the full check then runs, the done check's misses come back once, and `bin/land` merges the spec.",
    "- `stuck`: the spec has a gap or the code a fault you cannot fix, one only the owner can settle; `reason` says why, and the spec is marked `stuck`.",
    "`steps`: what the owner alone must do before the spec's work can run, like setting a dashboard value or adding a key, judged from what was built; each one named becomes an `owner-step` note once the spec lands. A fix that cannot build until the owner takes a step gives that step's exact title in `waits`, and builds once its note closes.",
    `\`fixes\`: each fault that belongs in another repo, or in code the spec never touched and is too big to fix here, at most ${MOST_FIXES}, each with one sure fix: \`fault\` and the evidence for it, \`title\`, and \`done\`, the sentences that will be true after the fix; each becomes a ticket the machine builds after the spec lands.`,
    "`risks`: any other fault, cost or risk you found, as `risk`, with `ends` naming its end: `fixed` by you here, `why` telling how; `nothing`, `why` telling why it can stand. Each choice the spec or the code leaves open is yours to make as its senior engineer; build your pick here. Only `steps` reach the owner.",
    "You are done reviewing when each fault, cost or risk you found sits in `fixes` or `risks`; both stay empty only when you found none. Nothing named in an earlier answer is dropped: a later one names only the findings it adds and those whose end it changes.",
    "`reason`: a paragraph telling the owner what the spec built and how its code holds to the standard. Every reviewer's `approve` `reason` is commented on the spec's PR before it merges, and below them each of your `fixes` and `risks` with its end.",
    "",
  ].join("\n\n");
}

const WHOLE_BRANCH = "This covers the whole integration branch, not only your slices: it is yours wherever it sits.";
const redOnReview = ({ verdict, failed }: Red) =>
  [`The full check ran on the reviewed branch and ended red: \`${verdict}\`. The end of each red step's part of its log:`, tailOf(failed, TAIL_CAP), "Make it pass, commit, and answer again: it runs again on each answer and holds the spec until it is green.", ""].join("\n\n");
const wholeBranchTold = ({ branch }: Reviewer, told: string) => (branch === undefined ? told : [WHOLE_BRANCH, told].join("\n\n"));
const landRefused = (refused: string) =>
  [
    "`bin/land` refused to land the spec. What it said:",
    refused,
    "Fix what it names, commit, and answer again. Where the branch conflicts with `origin/main`, as on migrations main took while it built, rebuild it in this tree on `origin/main` instead, such as one squashed commit with the migrations renumbered after main's: a head built on `origin/main` becomes the integration branch whole.",
  ].join("\n\n");

const missesTold = (spec: string, missed: [number, string, Try][]) =>
  [
    `The done check tried spec #${spec}'s sentences on the running app while the branch was reviewed, as its builders left it, and these did not hold:`,
    capped(missed.map(([number, sentence, one]) => `${number}. ${sentence}\n   ${one.tried}`).join("\n"), TAIL_CAP),
    "Make each hold here, in the app's code, and commit with a message saying why. Then answer again, naming in `fixed` the number of each sentence you made hold and saw hold; one the review already fixed counts once you see it hold. One you cannot make hold here lands as it is and is filed as a bug once the spec lands.",
    "",
  ].join("\n\n");

const briefsOf = (progress: Progress) =>
  progress.slices
    .map(({ id, title, why, done }) => `- \`${id}\`: ${title.trim()}\n  Why: ${why.trim()}\n  Done when: ${done.map((sentence) => sentence.trim()).join(" ")}`)
    .join("\n");

const shown = (shas: string[], ...args: string[]) => gitRead(["show", ...args, ...shas], UNREAD);

const wholeBranch = (): Changes => ({ commits: gitRead(["log", COMMITS, PAST_MAIN], UNREAD), diff: gitRead(["diff", FROM_MAIN], UNREAD), stat: gitRead(["diff", "--stat", FROM_MAIN], UNREAD) });

function packed(): Changes[] {
  const whole = wholeBranch();
  if (Buffer.byteLength(whole.diff) <= ONE_REVIEWER_CAP) return [whole];
  const branchOrder: string[] = [];
  const bySlice = new Map<string, string[]>();
  for (const line of gitRead(["log", "--reverse", "--format=%H%x00%(trailers:key=Slice,valueonly,separator=%x00)", PAST_MAIN], UNREAD).split("\n")) {
    const [sha = "", slice = UNSLICED] = line.split("\0");
    branchOrder.push(sha);
    bySlice.set(slice, [...(bySlice.get(slice) ?? []), sha]);
  }
  const sized = [...bySlice]
    .sort(([one], [other]) => Number(one === UNSLICED) - Number(other === UNSLICED))
    .map(([slice, shas]) => {
      const diff = shown(shas, "--format=");
      return { slice, shas, diff, bytes: Buffer.byteLength(diff) };
    });
  const packs: { held: typeof sized; bytes: number }[] = [];
  for (const one of [...sized].sort((bigger, smaller) => smaller.bytes - bigger.bytes)) {
    const room = packs.find(({ bytes }) => bytes + one.bytes <= ONE_REVIEWER_CAP);
    if (room === undefined) packs.push({ held: [one], bytes: one.bytes });
    else {
      room.held.push(one);
      room.bytes += one.bytes;
    }
  }
  return packs.map(({ held }) => {
    const slices = sized.filter((one) => held.includes(one));
    const shas = new Set(slices.flatMap((one) => one.shas));
    const inOrder = branchOrder.filter((sha) => shas.has(sha));
    return { slices: slices.map(({ slice }) => slice), commits: shown([...inOrder].reverse(), "--no-patch", COMMITS), diff: slices.map(({ diff }) => diff).join(""), stat: shown(inOrder, "--format=", "--stat") };
  });
}

interface Reviewer {
  spend: (input: string, resume?: string) => Promise<Spent>;
  session?: string | undefined;
  seat: string;
  slices: string[];
  tree: string;
  branch?: string;
}

interface Finished {
  landed?: string | undefined;
  missed?: number[] | undefined;
}

interface Approved extends Answered {
  reason: string;
  steps: OwnerStep[];
  fixed?: number[] | undefined;
}

type Tried = { tries: Try[]; fixed: number[] } | { refusal: string };

interface Reviewed {
  last: Reviewer;
  tried: Tried;
}

interface Run {
  spec: string;
  said: string;
  app: AppKey | undefined;
  listed: Sentence[];
  reasons: Map<string, string>;
  later: string[];
  left: Map<string, Approved>;
  trees: { roots: string[]; made: { tree: string; branch?: string | undefined }[]; readied: Set<string> };
}

function reviewed(spec: string, said: string, spent: Spent, app: AppKey | undefined): Approved | undefined {
  if (app !== undefined) freshAppToken(app, gh, `so the review of #${spec} is not acted on`);
  if (spent.refusal !== undefined) {
    endedRed(`${said} ended red, ${spent.refusal}`);
    return undefined;
  }
  const answer = spent.answer as ({ outcome?: unknown; reason?: unknown; fixed?: number[] } & Answered) | undefined;
  const reason = typeof answer?.reason === "string" ? answer.reason.trim() : "";
  if (reason === "") {
    endedRed(`${said} ended red, its reviewer gave no reason`);
    return undefined;
  }
  if (answer?.outcome === "stuck") {
    calledOwner(spec, { who: "a reviewer", said: `${said} marked ${STUCK}` }, reason);
    return undefined;
  }
  return { reason, steps: answer?.steps ?? [], fixes: answer?.fixes, risks: answer?.risks, fixed: answer?.fixed };
}

const pushedForRerun = (spec: string) => gitRead(["push", "--quiet", "--force", "origin", `HEAD:refs/heads/${specBranch(spec)}`], `${specBranch(spec)} would not push, so a rerun would lose its reviewers' fixes`);

const keptOnOrigin = ({ tree, branch }: Reviewer) =>
  inTree(tree, () => gitRead(["push", "--quiet", "--force", "origin", `HEAD:refs/heads/${branch}`], `${branch} would not push, so its reviewer's work lives only on this machine`));

const builtOnMain = () => git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]).status === 0;

function inTree<Done>(tree: string, act: () => Done): Done {
  const home = process.cwd();
  process.chdir(tree);
  try {
    return act();
  } finally {
    process.chdir(home);
  }
}

function settled({ spec, said, app, left }: Run, reviewer: Reviewer, spent: Spent, commit: string, before: string): Approved | undefined {
  reviewer.session = spent.session ?? reviewer.session;
  inTree(reviewer.tree, () => {
    committed(commit, "fix");
    const sliced = reviewer.slices.filter((slice) => slice !== UNSLICED);
    if (sliced.length > 0 && git(["merge-base", "--is-ancestor", before, "HEAD"]).status === 0) sliceTrailed(before, sliced);
  });
  if (reviewer.branch === undefined) pushedForRerun(spec);
  else keptOnOrigin(reviewer);
  const approved = reviewed(spec, said, spent, app);
  if (approved === undefined) return undefined;
  left.set(reviewer.seat, { ...approved, ...gathered(left.get(reviewer.seat), approved) });
  return approved;
}

async function answered(run: Run, reviewer: Reviewer, input: string, commit: string): Promise<Approved | undefined> {
  const before = inTree(reviewer.tree, head);
  return settled(run, reviewer, await reviewer.spend(input, reviewer.session), commit, before);
}

function reviewerLoop<Done>(run: Run, reviewer: Reviewer, { stops, commit, kept }: { stops: readonly Stop[]; commit: string; kept?: ((approved: Approved) => void) | undefined }, ahead: () => Ahead<Done> | Promise<Ahead<Done>>): Promise<Looped<Done | undefined>> {
  let before = "";
  return stageLoop<Done | undefined>({
    spend: (handed, resume) => {
      before = inTree(reviewer.tree, head);
      return reviewer.spend(handed, resume);
    },
    session: reviewer.session,
    stops,
    ahead,
    judged: (spent) => {
      const approved = settled(run, reviewer, spent, commit, before);
      if (approved === undefined) return { done: undefined };
      kept?.(approved);
      return { changed: inTree(reviewer.tree, head) !== before };
    },
  });
}

const packUnrebased = (onto: string, { files, said }: { files: string; said: string }) =>
  [
    files === "" ? `Your commits would not rebase onto \`${onto}\`, which took another pack's commits while you worked. Git said:` : `Your commits would not rebase onto \`${onto}\`, which took another pack's commits while you worked. The files they conflict in:`,
    capped(files || said, LIST_CAP),
    `Run \`git rebase ${onto}\` in this tree, resolve each conflict keeping what both sides meant, finish the rebase, and answer again.`,
    "",
  ].join("\n\n");

function broughtBack(spec: string, { tree, branch }: Reviewer, rebuilt: boolean): Refusal | undefined {
  if (branch === undefined) return undefined;
  const onto = specBranch(spec);
  if (rebuilt && !builtOnMain()) {
    const rebuild = inTree(tree, () => (builtOnMain() && git(["merge-base", "--is-ancestor", onto, "HEAD"]).status !== 0 ? head() : undefined));
    if (rebuild !== undefined) {
      gitRead(["reset", "--quiet", "--hard", rebuild], `${onto} could not take ${branch}'s rebuild on origin/main`);
      pushedForRerun(spec);
      return undefined;
    }
  }
  const stopped = inTree(tree, () => (fastForwards(onto) ? undefined : rebaseStopped(onto)));
  if (stopped !== undefined) return { refused: `${branch} would not rebase onto ${onto}`, handBack: packUnrebased(onto, stopped) };
  if (!fastForwarded(spec, branch)) unread(`${onto} would not fast-forward to ${branch} though it was rebased onto it`);
  return undefined;
}

async function rounds<Done>(run: Run, reviewer: Reviewer, { failed, rebuilt = false, commit, kept }: { failed: string; rebuilt?: boolean; commit: string; kept?: (approved: Approved) => void }, attempt: () => Ahead<Done> | Promise<Ahead<Done>>): Promise<Done | undefined> {
  const looped = await reviewerLoop(run, reviewer, { stops: ["unchanged"], commit, kept }, async () => broughtBack(run.spec, reviewer, rebuilt) ?? (await attempt()));
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
  rounds(run, reviewer, { failed: "stayed red on its full check", commit, kept: (approved) => run.later.push(`After its full check went red: ${approved.reason}`) }, async () => {
    const red = await checkedBy(PUBLISHED_CHECK);
    if (stoppedByMachine(run, red)) return { done: undefined };
    return red === undefined ? { done: true } : { refused: red.verdict, handBack: wholeBranchTold(reviewer, redOnReview(red)) };
  });

async function stepsWhole(run: Run, reviewer: Reviewer, commit: string): Promise<boolean> {
  const looped = await reviewerLoop(run, reviewer, { stops: ["again"], commit }, () => {
    const refused = stepsUnfileable(run.left.get(reviewer.seat)?.steps ?? []);
    return refused === undefined ? { done: true } : { refused, handBack: refused };
  });
  if ("done" in looped) return looped.done === true;
  endedRed(`${run.said} landed nothing, its reviewer answered the same refused owner steps again: ${looped.refused}`);
  return false;
}

const merged = (run: Run, reviewer: Reviewer, commit: string) => rounds(run, reviewer, { failed: "left a pack's commits conflicting with its integration branch", commit }, () => ({ done: true }));

async function treeMade(run: Run, reviewer: Reviewer): Promise<boolean> {
  const { spec, said, trees } = run;
  if (trees.readied.has(reviewer.tree)) return true;
  trees.readied.add(reviewer.tree);
  if (reviewer.branch !== undefined) {
    worktree(spec, reviewer.branch, reviewer.tree);
    trees.made.push(reviewer);
  }
  const unready = await setupRefusedIn(reviewer.tree, onDisk(join(reviewer.tree, CONTRACT)) ?? "");
  if (unready === undefined) return true;
  endedRed(`${said} ended red, the tree for ${reviewer.branch ?? specBranch(spec)} would not set up: ${unready}`);
  return false;
}

function treesRoot({ trees }: Run, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  trees.roots.push(root);
  return root;
}

function treesRemoved({ trees: { roots, made } }: Run): void {
  for (const { tree, branch } of made) if (branch !== undefined) removed(branch, tree);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

function triedOnBranch(run: Run): Promise<Try[] | { refusal: string }> {
  const { spec, app } = run;
  const tree = join(treesRoot(run, "spec-done-"), "tree");
  const branch = `review/${spec}-done`;
  worktree(spec, branch, tree);
  run.trees.made.push({ tree, branch });
  if (app !== undefined) freshAppToken(app, gh, `so the done check of #${spec} is not tried`);
  return triedIn(tree, spec).catch((error: unknown) => {
    if (error instanceof Stopped) return { refusal: error.message };
    throw error;
  });
}

async function heldAfterRound(run: Run, last: Reviewer, tries: Try[] | { refusal: string }): Promise<Tried | undefined> {
  if (!Array.isArray(tries)) return tries;
  const missed = paired(run.listed, tries).flatMap(([number, said, one]): [number, string, Try][] => (one?.outcome === "missed" ? [[number, said, one]] : []));
  if (missed.length === 0) return { tries, fixed: [] };
  const handed: Refusal[] = [{ refused: `the done check missed sentence ${missed.map(([number]) => number).join(", ")}`, handBack: missesTold(run.spec, missed) }];
  let fixed: number[] = [];
  const held = await rounds(
    run,
    last,
    { failed: "left its commits conflicting with its integration branch after the done check's round", commit: `Make what the done check missed on #${run.spec} hold`, kept: (approved) => {
      fixed = approved.fixed ?? [];
      run.later.push(`After the done check: ${approved.reason}`);
    } },
    () => handed.shift() ?? { done: true },
  );
  return held === undefined ? undefined : { tries, fixed: fixed.filter((number) => missed.some(([at]) => at === number)) };
}

async function atMost<Done>(most: number, jobs: (() => Promise<Done | undefined>)[]): Promise<Done[] | undefined> {
  const done: Done[] = [];
  let next = 0;
  let stopped = false;
  const taken = async () => {
    for (let job = jobs[next]; job !== undefined && !stopped; job = jobs[next]) {
      const at = next++;
      const ended = await job();
      if (ended === undefined) stopped = true;
      else done[at] = ended;
    }
  };
  await Promise.all(Array.from({ length: Math.min(most, jobs.length) }, taken));
  return stopped ? undefined : done;
}

async function reviews(run: Run, { title, body }: { title: string; body: string }, progress: Progress): Promise<Reviewed | undefined> {
  const { spec } = run;
  const top = process.cwd();
  const trying = triedOnBranch(run);
  const commitlint = commitlinted();
  const briefs = briefsOf(progress);
  const packs = packed();
  const root = packs.length === 1 ? undefined : treesRoot(run, "spec-review-");
  const commit = `Review #${spec}`;
  const answers = await atMost(
    MOST_BUILDERS,
    packs.map((changes, at) => async () => {
      const seat = root === undefined ? spec : `${spec}-${at + 1}`;
      const tree = root === undefined ? top : join(root, String(at + 1));
      const reviewer: Reviewer = {
        spend: hireIn(tree, "finish", seat, { name: "reviewer", model: "opus", effort: "medium", answers: ANSWER }),
        seat,
        slices: changes.slices ?? [],
        tree,
        ...(root === undefined ? {} : { branch: `review/${seat}` }),
      };
      if (!(await treeMade(run, reviewer))) return undefined;
      const answer = await answered(run, reviewer, onTheBranch(changes, { spec, title, body, commitlint, briefs }), commit);
      if (answer === undefined || !(await stepsWhole(run, reviewer, commit))) return undefined;
      return (await merged(run, reviewer, commit)) === true ? { reviewer, answer } : undefined;
    }),
  );
  const last = answers?.at(-1)?.reviewer;
  if (answers === undefined || last === undefined) return undefined;
  for (const { reviewer, answer } of answers) run.reasons.set(reviewer.seat, reviewer.slices.length === 0 ? answer.reason : `On ${slicesNamed(reviewer.slices)}: ${answer.reason}`);
  if ((await greened(run, last, commit)) === undefined) return undefined;
  const tried = await heldAfterRound(run, last, await trying);
  return tried === undefined ? undefined : { last, tried };
}

function landed(run: Run, { last }: Reviewed): Promise<string | undefined> {
  const { spec, said, reasons, later, left } = run;
  return rounds(run, last, { failed: "did not land", rebuilt: true, commit: `Fix what bin/land refused for #${spec}`, kept: (approved) => later.push(afterRefused(approved.reason)) }, (): Ahead<string | undefined> => {
    const stood = stoodDown(standingOn(spec, gh));
    if (stood !== undefined) {
      console.log(`${said} ${stood}, so its reviewed branch does not land`);
      return { done: undefined };
    }
    const attempt = landing(["--spec", spec], approvedOn([...reasons.values(), ...later], followUpsOf(left)));
    if ("pr" in attempt) return { done: attempt.pr };
    return { refused: attempt.refused, handBack: wholeBranchTold(last, landRefused(attempt.refused)) };
  });
}

const followUpsOf = (left: Map<string, Approved>): FollowUps => gathered(...left.values());

function leftFiled(spec: string, followUps: FollowUps): void {
  const refused = filed(followUps, { found: fromLine(fromHere(spec), "review"), left: `Left to the owner by the run that landed spec #${spec}.` }).filter(({ refusals }) => refusals.length > 0);
  if (refused.length > 0) commentOnTicket(spec, [`What the reviewers of #${spec} left that could not be filed:`, "", ...refused.map(({ named, refusals }) => `- ${named} (${quoted(refusals[0] ?? "")})`), ""].join("\n"), gh);
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
  const listed = sentences(asked.body);
  const { landed: landedAs, tries, fixed = [] } = found.progress;
  if (landedAs === undefined && gitRead(["rev-list", "--count", PAST_MAIN], UNREAD) === "0") {
    endedRed(`${said} holds nothing past main on its integration branch, ${unchanged}`);
    return {};
  }
  if (landedAs !== undefined && tries === undefined) {
    gitRead(["checkout", "--quiet", "-B", specBranch(spec), "origin/main"], `${specBranch(spec)} could not be checked out at origin/main, so its done check was not run`);
    return finishedWith(landedAs, () => doneCheck(spec, app));
  }
  mark(spec, CHECKING);
  if (landedAs !== undefined && tries !== undefined) return closedFrom(spec, app, listed, { tries, fixed }, landedAs);
  const run: Run = { spec, said, app, listed, reasons: new Map(), later: [], left: new Map(), trees: { roots: [], made: [], readied: new Set() } };
  const ended = await (async () => {
    try {
      const review = await reviews(run, asked, found.progress);
      if (review === undefined) return undefined;
      if ("tries" in review.tried) triedOn(spec, found, review.tried);
      const pr = await landed(run, review);
      return pr === undefined ? undefined : { pr, tried: review.tried };
    } finally {
      treesRemoved(run);
    }
  })();
  if (ended === undefined) return {};
  landedOn(spec, found, ended.pr);
  leftFiled(spec, followUpsOf(run.left));
  const { pr, tried } = ended;
  if ("refusal" in tried) {
    await readOrStop("done-check", () => doneCheckCalledOwner(spec, tried.refusal));
    return { landed: pr };
  }
  return closedFrom(spec, app, listed, tried, pr);
}

async function finishedWith(pr: string, check: () => Checked | number | Promise<Checked | number>): Promise<Finished> {
  const checked = await readOrStop("done-check", check);
  return { landed: pr, missed: typeof checked === "object" ? checked.missed : undefined };
}

const closedFrom = (spec: string, app: AppKey | undefined, listed: Sentence[], { tries, fixed }: { tries: Try[]; fixed: number[] }, pr: string) =>
  finishedWith(pr, () => {
    if (app !== undefined) freshAppToken(app, gh, `so the done check of #${spec} is not posted`);
    return postedOn(spec, listed, tries, fixed);
  });

if (import.meta.main) {
  const [spec] = process.argv.slice(2);
  if (spec === undefined) throw new Error("no spec number in the arguments");
  const ended = await readOrStop("finish", () => finished(spec, takenAppKey()));
  const { landed: pr = "", missed } = typeof ended === "object" ? ended : {};
  console.log(`landed=${pr}\nmissed=${(missed ?? []).join(",")}`);
  process.exit(pr !== "" && missed !== undefined ? 0 : 1);
}
