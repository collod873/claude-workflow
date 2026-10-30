import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capped, DIFF_CAP, diffOverCap, LIST_CAP, NO_EM_DASH, onDisk, TAIL_CAP, tailOf } from "./brief.ts";
import { checkedBy, type Red, starvedFault } from "./builder.ts";
import { PUBLISHED_CHECK } from "./checks.ts";
import { doneCheck } from "./done-checker.ts";
import { askedIssue, commentOnTicket, FOLLOW_UP_OF, gh, ghRead, git, gitRead, heldOn, labelsHeld, mark, OWNER, readOrStop, REVIEW_LET_THROUGH, STUCK, unread } from "./post.ts";
import { afterRefused, approvedOn, firstTimeNamed, gathered, landing, type Routed, ROUTED, ROUTED_REQUIRED, routedFiled } from "./reviewer.ts";
import { fastForwarded, landedOn, MOST_BUILDERS, type Progress, progressOn, removed, specBranch, worktree } from "./scheduler.ts";
import { fastForwards, rebaseStopped, sliceTrailed } from "./slice-builder.ts";
import { committed, commitlinted, CONTRACT, head, hireIn, MOST_FIXES, type OwnerStep, OWNER_STEPS, setupRefusedIn, type Spent } from "./stage.ts";
import { SPEC } from "./spelled.ts";
import { stopsOf } from "./stops.ts";
import { quoted, SPEC_CAP } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  unfinishable: "Finish refused: the issue is not labelled `spec`, or its integration branch holds nothing past main",
  unlanded: "Finish: `bin/land` refused the integration branch, and two rounds in a row of its last reviewer changed nothing",
  unchecked: "Finish: the full check stayed red, and two rounds in a row of the reviewer handed it changed nothing",
  reviewerStuck: "Finish: a reviewer answered `stuck`, so the spec is marked `stuck` and the owner is called",
  unmerged: "Finish: a pack's reviewer left its commits conflicting with the integration branch, and two rounds in a row of it changed nothing",
  machineStarved: "Finish: the full check went red only on steps the machine starved of memory, so the spec is marked `stuck` and the owner is called",
  unready: "Finish: a pack's tree would not set up, so its reviewer on the code standard was not hired",
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
  slices?: string[] | undefined;
  commits: string;
  diff: string;
  stat: string;
}

const UNSLICED = "";
const sliceNamed = (slice: string) => (slice === UNSLICED ? "the commits naming no slice" : `slice \`${capped(slice, SLICE_CAP)}\``);
const slicesNamed = (slices: string[]) => capped(new Intl.ListFormat("en").format(slices.map(sliceNamed)), LIST_CAP);
const alone = ({ slices }: Changes) =>
  slices === undefined
    ? []
    : [
        `The diff is over ${ONE_REVIEWER_CAP} bytes, so the review on the code standard is packed into whole slices under that cap, each pack with its own reviewer, and you review what ${slicesNamed(slices)} built: the commits and diff below are ${slices.length === 1 ? "its" : "theirs"} alone, one patch per commit. Read the rest of the branch too for code that copies what ${slices.length === 1 ? "this slice" : "these slices"} wrote, such as a helper, a type or a query written twice, and make it one.`,
        "The other packs' reviewers work at the same time, each in its own tree on its own branch, and your commits are rebased onto the integration branch once you answer; a conflict comes back to you.",
      ];
const codeDiff = ({ diff, stat }: Changes) => {
  const over = diffOverCap(diff, stat);
  return over === undefined
    ? diff
    : [`At ${over.bytes} bytes this diff is over the ${DIFF_CAP} handed, so here are its \`git diff --stat\` and the files it changes; read each file in the repo.`, over.stat, over.files].join("\n\n");
};

export function onTheCode(changes: Changes, { spec, red, commitlint }: { spec: string; red?: Red | undefined; commitlint: boolean }): string {
  const built = "Builders built this spec slice by slice on its integration branch, and a reviewer on the spec has read it and fixed what it missed.";
  return [
    `# Hold spec #${spec} to the code standard before it lands`,
    `${built} You did not build it: read its commit messages and diff as its reviewer on the code standard.`,
    ...alone(changes),
    ...(red === undefined
      ? []
      : [
          "## Its full check is red",
          `\`${PUBLISHED_CHECK}\` went red on this branch once the reviewer on the spec was done: \`${red.verdict}\`. The red may sit in any slice's code, and it is yours wherever it sits: make it pass, since the check runs again when you answer and holds you until it passes. The end of each red step's part of its log:`,
          tailOf(red.failed, TAIL_CAP),
        ]),
    "## Commits, newest first",
    "`git show <id>` reads one; `git log origin/main..HEAD` reads those cut here.",
    capped(changes.commits, LIST_CAP),
    "## The diff",
    codeDiff(changes),
    ...(commitlint ? ["Commitlint runs on this repo: write each commit message as `type: subject`, a conventional type, the subject lower-case."] : []),
    "## Fix it",
    "First call the Skill tool with `coding-standards` and then with `testing`: they hold the code standard and the test standard you judge by. Where the code breaks either, fix it here yourself: nothing goes back to a builder, and nothing after you but `bin/land`'s full check reads it. Done when every file the diff changes meets every rule of `coding-standards`, and every new or changed test passes the `testing` skill's checks.",
    "Commit each fix with a message saying why, free of em dashes and of closing keywords such as `Fixes #12`.",
    "## Your answer",
    "Answer one outcome:",
    "- `approve`: the code meets the standard, with whatever you fixed; once every reviewer approves, `bin/land` runs the full check and merges the spec, and what it refuses comes back to the last reviewer on the code standard.",
    "- `stuck`: a fault you cannot fix stands, and only the owner can settle it; `reason` says why, and the spec is marked `stuck`.",
    `\`fixes\`: at most ${MOST_FIXES} faults outside this repo or too big for this branch, each with one sure fix: \`fault\` and its evidence, \`title\`, and \`done\` stating what holds once it is fixed. Each becomes a ticket built after the spec lands.`,
    "`risks`: every other fault, cost or risk you saw, as `risk`, with `ends`: `fixed` here by you, `why` saying how; `nothing`, `why` saying why it can stand. Where the code leaves a choice open, you make it, as a senior engineer would, and fix it here.",
    "The review is done once every fault, cost or risk you saw is in `fixes` or `risks`, and both are empty only when you saw none. What you name stays filed across your answers, so a later answer holds only what is new to it or whose end has moved.",
    "`reason`: one paragraph for the owner on how the code holds to the standard. It is commented on the spec's PR before it merges, with every one of your `fixes` and `risks` and its end.",
    "",
  ].join("\n\n");
}

const specDiff = ({ diff, stat }: Changes) => {
  const over = diffOverCap(diff, stat);
  return over === undefined
    ? diff
    : [`The diff is ${over.bytes} bytes, over ${DIFF_CAP}, so only its \`git diff --stat\` and its files are handed; read in the repo what you need of it.`, over.stat, "Every file changed:", over.files].join("\n\n");
};

export function onTheSpec(changes: Changes, { spec, title, body, commitlint, briefs }: { spec: string; title: string; body: string; commitlint: boolean; briefs: string }): string {
  const built =
    "Builders built the spec below slice by slice on its integration branch, each slice to its brief under `## Its slices`. You did not build it: read the spec, the briefs, its commit messages and its diff, over the whole branch, as its reviewer on the spec.";
  const fix =
    "Where the branch misses what the spec asks, builds what it rules out of scope, or leaves any story or any sentence under `## I'll know it works when I can` short of whole, build the rest here yourself: nothing goes back to a builder. Once it lands, a fresh done check tries each of those sentences.";
  return [
    `# Hold spec #${spec} to what it asks before it lands`,
    `${built} A reviewer on the code standard reads the branch after you, your fixes with it.`,
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    "## Its slices",
    "Each slice the slicer cut, with the brief its builder built to:",
    capped(briefs, BRIEFS_CAP) || "(none on record)",
    "Its commits are listed newest first, each with its id: `git show <id>` reads one, and `git log origin/main..HEAD` reads any the list cuts.",
    "## Commits",
    capped(changes.commits, LIST_CAP),
    "## Diff from main",
    specDiff(changes),
    ...(commitlint ? ["commitlint checks each commit here: a message reads `type: subject`, with a conventional type such as `fix` or `feat` and a lower-case subject."] : []),
    "## Fix it",
    fix,
    "Every change you make goes in a commit whose message gives the reason, using neither an em dash nor an issue-closing word like `Closes #12`.",
    "## Your answer",
    "Answer one outcome:",
    "- `approve`: the branch builds what the spec asks, with whatever you fixed; the reviewers on the code standard read it next, then `bin/land` runs the full check and merges it.",
    "- `stuck`: the spec has a gap you cannot fix, one only the owner can close; `reason` says why, and the spec is marked `stuck`.",
    "`steps`: what the owner alone must do before the spec's work can run, like setting a dashboard value or adding a key, judged from what was built; each one named becomes an `owner-step` note once the spec lands. A fix that cannot build until the owner takes a step gives that step's exact title in `after`, and builds once its note closes.",
    `\`fixes\`: each fault that belongs in another repo, or in code the spec never touched and is too big to fix here, at most ${MOST_FIXES}, each with one sure fix: \`fault\` and the evidence for it, \`title\`, and \`done\`, the sentences that will be true after the fix; each becomes a ticket the machine builds after the spec lands.`,
    "`risks`: any other fault, cost or risk you found, as `risk`, with `ends` naming its end: `fixed` by you here, `why` telling how; `nothing`, `why` telling why it can stand. Each choice the spec leaves open is yours to make as its senior engineer; build your pick here. Only `steps` reach the owner.",
    "You are done reviewing when each fault, cost or risk you found sits in `fixes` or `risks`; both stay empty only when you found none. Nothing named in an earlier answer is dropped: a later one names only the findings it adds and those whose end it changes.",
    "`reason`: a paragraph telling the owner what the spec built. Every reviewer's `approve` `reason` is commented on the spec's PR before it merges, and below them each of your `fixes` and `risks` with its end.",
    "",
  ].join("\n\n");
}

const WHOLE_BRANCH = "This refusal covers the whole integration branch, not only your slice: it is yours wherever it sits.";
const stillRedOnReview = ({ verdict, failed }: Red) =>
  [`The full check still ends red after your answer: \`${verdict}\`. The end of each red step's part of its log:`, tailOf(failed, TAIL_CAP), "Make it pass, commit, and answer again.", ""].join("\n\n");
const landRefused = (refused: string) => ["`bin/land` refused to land the spec. What it said:", refused, "Fix what it names, commit, and answer again."].join("\n\n");

const briefsOf = (progress: Progress) =>
  progress.slices
    .map(({ id, title, why, done }) => `- \`${id}\`: ${title.trim()}\n  Why: ${why.trim()}\n  Done when: ${done.map((sentence) => sentence.trim()).join(" ")}`)
    .join("\n");

const shown = (shas: string[], ...args: string[]) => gitRead(["show", ...args, ...shas], UNREAD);

const wholeBranch = (): Changes => ({ commits: gitRead(["log", COMMITS, PAST_MAIN], UNREAD), diff: gitRead(["diff", FROM_MAIN], UNREAD), stat: gitRead(["diff", "--stat", FROM_MAIN], UNREAD) });

function onTheCodeInPacks(): Changes[] {
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
  on: string;
  slices: string[];
  stepped: boolean;
  tree: string;
  branch?: string;
}

interface Finished {
  landed?: string | undefined;
  missed?: number[] | undefined;
}

interface Approved extends Routed {
  reason: string;
  steps: OwnerStep[];
}

interface Reviewed {
  last: Reviewer;
}

interface Run {
  spec: string;
  said: string;
  app: AppKey | undefined;
  reasons: Map<string, string>;
  later: string[];
  left: Map<string, Approved>;
  trees: { root?: string | undefined; made: Reviewer[] };
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

function inTree<Done>(tree: string, act: () => Done): Done {
  const home = process.cwd();
  process.chdir(tree);
  try {
    return act();
  } finally {
    process.chdir(home);
  }
}

async function answered({ spec, said, app, left }: Run, reviewer: Reviewer, input: string, commit: string): Promise<Approved | undefined> {
  const before = inTree(reviewer.tree, head);
  const spent = await reviewer.spend(input, reviewer.session);
  reviewer.session = spent.session ?? reviewer.session;
  const approved = reviewed(spec, said, spent, app);
  if (approved === undefined) return undefined;
  inTree(reviewer.tree, () => {
    committed(commit, "fix");
    const sliced = reviewer.slices.filter((slice) => slice !== UNSLICED);
    if (sliced.length > 0 && git(["merge-base", "--is-ancestor", before, "HEAD"]).status === 0) sliceTrailed(before, sliced);
  });
  if (reviewer.branch === undefined) pushedForRerun(spec);
  left.set(reviewer.seat, { ...approved, ...gathered(left.get(reviewer.seat), reviewer.stepped ? approved : { ...approved, steps: [] }) });
  return approved;
}

type Round<Done> = { done: Done } | { refused: string; told: string };

const packUnrebased = (onto: string, { files, said }: { files: string; said: string }) =>
  [
    files === "" ? `Your commits would not rebase onto \`${onto}\`, which took another pack's commits while you worked. Git said:` : `Your commits would not rebase onto \`${onto}\`, which took another pack's commits while you worked. The files they conflict in:`,
    capped(files || said, LIST_CAP),
    `Run \`git rebase ${onto}\` in this tree, resolve each conflict keeping what both sides meant, finish the rebase, and answer again.`,
    "",
  ].join("\n\n");

function broughtBack(spec: string, { tree, branch }: Reviewer): Round<never> | undefined {
  if (branch === undefined) return undefined;
  const onto = specBranch(spec);
  const stopped = inTree(tree, () => (fastForwards(onto) ? undefined : rebaseStopped(onto)));
  if (stopped !== undefined) return { refused: `${branch} would not rebase onto ${onto}`, told: packUnrebased(onto, stopped) };
  if (!fastForwarded(spec, branch)) unread(`${onto} would not fast-forward to ${branch} though it was rebased onto it`);
  return undefined;
}

async function rounds<Done>(run: Run, reviewer: Reviewer, { failed, stop, commit, kept }: { failed: string; stop: "unlanded" | "unchecked" | "unmerged"; commit: string; kept: (approved: Approved) => void }, attempt: () => Round<Done>): Promise<Done | undefined> {
  let idle = false;
  for (;;) {
    const tried = broughtBack(run.spec, reviewer) ?? attempt();
    if ("done" in tried) return tried.done;
    const before = inTree(reviewer.tree, head);
    const approved = await answered(run, reviewer, tried.told, commit);
    if (approved === undefined) return undefined;
    kept(approved);
    const changed = inTree(reviewer.tree, head) !== before;
    if (!changed && idle) {
      stoppedAt(stop, `${run.said} ${failed}, and two rounds in a row of its reviewer changed nothing: ${quoted(tried.refused.split("\n").at(-1) ?? "")}`);
      return undefined;
    }
    idle = !changed;
  }
}

function starved({ spec, said }: Run, red: Red | undefined): boolean {
  const fault = starvedFault(red);
  if (fault === undefined) return false;
  mark(spec, STUCK);
  commentOnTicket(spec, `@${OWNER} the finisher of #${spec} stopped and needs you: ${fault}`, gh);
  stoppedAt("machineStarved", `${said} marked ${STUCK}, ${fault}`);
  return true;
}

const greened = (run: Run, reviewer: Reviewer, commit: string) =>
  rounds(run, reviewer, { failed: "stayed red on its full check", stop: "unchecked", commit, kept: (approved) => run.later.push(`After its full check went red: ${approved.reason}`) }, () => {
    const red = checkedBy(PUBLISHED_CHECK);
    if (starved(run, red)) return { done: undefined };
    return red === undefined ? { done: true } : { refused: red.verdict, told: stillRedOnReview(red) };
  });

const merged = (run: Run, reviewer: Reviewer, commit: string) => rounds(run, reviewer, { failed: "left a pack's commits conflicting with its integration branch", stop: "unmerged", commit, kept: () => undefined }, () => ({ done: true }));

async function treeMade(run: Run, reviewer: Reviewer): Promise<boolean> {
  const { spec, said, trees } = run;
  if (reviewer.branch === undefined) return true;
  worktree(spec, reviewer.branch, reviewer.tree);
  trees.made.push(reviewer);
  const unready = await setupRefusedIn(reviewer.tree, onDisk(join(reviewer.tree, CONTRACT)) ?? "");
  if (unready === undefined) return true;
  stoppedAt("unready", `${said} ended red, the tree for ${reviewer.branch} would not set up: ${unready}`);
  return false;
}

function treesRemoved({ trees: { root, made } }: Run): void {
  for (const { tree, branch } of made) if (branch !== undefined) removed(branch, tree);
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
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
  const commitlint = commitlinted();
  const reviewer = (seat: string, on: "spec" | "code standard", answers: object, { tree = top, slices }: { tree?: string; slices?: string[] | undefined } = {}): Reviewer => ({
    spend: hireIn(tree, "finish", seat, { name: `reviewer on the ${on}`, model: "opus", answers }),
    seat,
    on: `On the ${on}${slices === undefined ? "" : `, ${slicesNamed(slices)}`}`,
    slices: slices ?? [],
    stepped: answers === ANSWER,
    tree,
    ...(tree === top ? {} : { branch: `review/${seat}` }),
  });
  const onSpec = reviewer(`${spec}-spec`, "spec", ANSWER);
  const approved = await answered(run, onSpec, onTheSpec(wholeBranch(), { spec, title, body, commitlint, briefs: briefsOf(progress) }), `Review #${spec} on the spec`);
  if (approved === undefined) return undefined;
  run.reasons.set(onSpec.seat, `${onSpec.on}: ${approved.reason}`);
  const red = checkedBy(PUBLISHED_CHECK);
  if (starved(run, red)) return undefined;
  const packs = onTheCodeInPacks();
  const root = packs.length === 1 ? undefined : mkdtempSync(join(tmpdir(), "spec-review-"));
  run.trees.root = root;
  const commit = `Review #${spec} on the code standard`;
  const packed = await atMost(
    MOST_BUILDERS,
    packs.map((changes, at) => async () => {
      const ofPack = reviewer(`${spec}-code-${at + 1}`, "code standard", CODE_ANSWER, root === undefined ? {} : { tree: join(root, String(at + 1)), slices: changes.slices });
      if (!(await treeMade(run, ofPack))) return undefined;
      const answer = await answered(run, ofPack, onTheCode(changes, { spec, red: at === 0 ? red : undefined, commitlint }), commit);
      return answer !== undefined && (await merged(run, ofPack, commit)) === true ? { ofPack, answer } : undefined;
    }),
  );
  const [first, ...rest] = packed ?? [];
  if (first === undefined) return undefined;
  for (const { ofPack, answer } of [first, ...rest]) run.reasons.set(ofPack.seat, `${ofPack.on}: ${answer.reason}`);
  if (red !== undefined && (await greened(run, first.ofPack, commit)) === undefined) return undefined;
  return { last: (rest.at(-1) ?? first).ofPack };
}

function landed(run: Run, { last }: Reviewed): Promise<string | undefined> {
  const { spec, said, reasons, later, left } = run;
  return rounds(run, last, { failed: "did not land", stop: "unlanded", commit: `Fix what bin/land refused for #${spec}`, kept: (approved) => later.push(afterRefused(approved.reason)) }, (): Round<string | undefined> => {
    const held = heldOn(labelsHeld(spec, gh));
    if (held !== undefined) {
      console.log(`${said} is marked ${held}, so its reviewed branch does not land`);
      return { done: undefined };
    }
    const attempt = landing(["--spec", spec], approvedOn([...reasons.values()], later, [...left.values()]));
    if ("pr" in attempt) return { done: attempt.pr };
    return { refused: attempt.refused, told: last.branch === undefined ? landRefused(attempt.refused) : [WHOLE_BRANCH, landRefused(attempt.refused)].join("\n\n") };
  });
}

function leftFiled(spec: string, approved: Approved[]): void {
  const unfiled = firstTimeNamed();
  const once = approved.flatMap(({ steps }) => steps).filter(({ title }) => unfiled(title));
  const filed = routedFiled(`${FOLLOW_UP_OF}${spec}${REVIEW_LET_THROUGH}`, `Left to the owner by the run that landed spec #${spec}.`, once, approved);
  const refused = filed.filter(({ refusals }) => refusals.length > 0);
  if (refused.length > 0) commentOnTicket(spec, [`What the reviewers of #${spec} left that could not be filed:`, "", ...refused.map(({ named, refusals }) => `- ${named} (${quoted(refusals[0] ?? "")})`), ""].join("\n"), gh);
}

async function finished(spec: string, app: AppKey | undefined): Promise<Finished> {
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
  const found = progressOn(spec);
  const checkedOnMain = (pr: string) => {
    gitRead(["checkout", "--quiet", "-B", specBranch(spec), "origin/main"], `${specBranch(spec)} could not be checked out at origin/main, so its done check was not run`);
    return checkedAfter(spec, pr, app);
  };
  if (found.progress.landed !== undefined) return checkedOnMain(found.progress.landed);
  if (gitRead(["rev-list", "--count", PAST_MAIN], UNREAD) === "0") {
    stoppedAt("unfinishable", `${said} holds nothing past main on its integration branch, ${unchanged}`);
    return {};
  }
  const run: Run = { spec, said, app, reasons: new Map(), later: [], left: new Map(), trees: { made: [] } };
  const pr = await (async () => {
    try {
      const review = await reviews(run, asked, found.progress);
      return review === undefined ? undefined : await landed(run, review);
    } finally {
      treesRemoved(run);
    }
  })();
  if (pr === undefined) return {};
  landedOn(spec, found, pr);
  leftFiled(spec, [...run.left.values()]);
  return checkedAfter(spec, pr, app);
}

function checkedAfter(spec: string, pr: string, app: AppKey | undefined): Finished {
  const checked = readOrStop("done-check", () => doneCheck(spec, app));
  return { landed: pr, missed: typeof checked === "object" ? checked.missed : undefined };
}

if (import.meta.main) {
  const [spec] = process.argv.slice(2);
  if (spec === undefined) throw new Error("no spec number in the arguments");
  const ended = await finished(spec, takenAppKey()).catch((error: unknown) =>
    readOrStop("finish", () => {
      throw error;
    }),
  );
  const { landed: pr = "", missed } = typeof ended === "object" ? ended : {};
  console.log(`landed=${pr}\nmissed=${(missed ?? []).join(",")}`);
  process.exit(pr !== "" && missed !== undefined ? 0 : 1);
}
