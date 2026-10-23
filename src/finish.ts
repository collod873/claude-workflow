import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, DIFF_CAP, NO_EM_DASH, TAIL_CAP, tailOf } from "./brief.ts";
import { CHECK, checkedBy } from "./builder.ts";
import { doneCheck } from "./done-checker.ts";
import { askedIssue, commentOnTicket, gh, ghRead, gitRead, heldOn, labelsHeld, mark, OWNER, readOrStop, STUCK, unread } from "./post.ts";
import { COMMIT_WHY, landing, landRefused, ownerStepFiled, reviewedChange, RISKS_LET_THROUGH, STANDARDS_LOADED, STEPS_ASKED, stuckAsked, TESTS_ARE_YOURS } from "./reviewer.ts";
import { committed, commitlinted, head, hire, linted, type OwnerStep, OWNER_STEPS, type Spent } from "./stage.ts";
import { SPEC } from "./spelled.ts";
import { stopsOf } from "./stops.ts";
import { quoted, SPEC_CAP } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  unfinishable: "Finish refused: the issue is not labelled `spec`, or its integration branch holds nothing past main",
  unlanded: "Finish: `bin/land` refused the integration branch, and two rounds in a row of its last reviewer changed nothing",
  reviewerStuck: "Finish: a reviewer answered `stuck`, so the spec is marked `stuck` and the owner is called",
});

const PAST_MAIN = "origin/main..HEAD";
const FROM_MAIN = "origin/main...HEAD";
const COMMITS = "--format=- %s%n%n%b";
const UNREAD = "the commits past main could not be read, so nothing was reviewed";
export const SLICE_CAP = 256;

const ANSWER = {
  type: "object",
  properties: { outcome: { enum: ["approve", "stuck"] }, reason: { type: "string", pattern: NO_EM_DASH }, steps: OWNER_STEPS },
  required: ["outcome", "reason"],
  additionalProperties: false,
};

export interface Changes {
  slice?: string;
  commits: string;
  diff: string;
  stat: string;
}

const UNSLICED = "";
const sliceNamed = ({ slice }: Changes) => (slice === undefined ? undefined : slice === UNSLICED ? "the commits naming no slice" : `slice \`${capped(slice, SLICE_CAP)}\``);
const alone = (changes: Changes) => {
  const slice = sliceNamed(changes);
  return slice === undefined ? [] : [`The diff is over its cap, so you review only what ${slice} built, and each other slice has its own reviewer: judge this part alone.`];
};
const trailer = ({ slice }: Changes) => (slice === undefined || slice === UNSLICED ? "" : `Slice: ${capped(slice, SLICE_CAP)}`);
const trailed = (changes: Changes) => (trailer(changes) === "" ? "" : ` End each message with the line \`${trailer(changes)}\`, so the review after yours reads your fix with its slice.`);
const answerAsked = [
  "Answer one outcome:",
  "- `approve`: it holds, with whatever you fixed; once every reviewer approves, `bin/land` runs the full check and merges it, and anything it refuses comes back to the last reviewer.",
  stuckAsked("spec"),
  `${STEPS_ASKED}, since those of each reviewer's last answer are each filed as an \`owner-step\` note once the spec lands.`,
  `\`reason\`: one paragraph for the owner. An \`approve\`'s \`reason\` is commented on the spec's PR before it merges: ${RISKS_LET_THROUGH}`,
];

export function onTheCode(changes: Changes, { spec, red, commitlint }: { spec: string; red?: string; commitlint: boolean }): string {
  return [
    `# Hold spec #${spec} to the code standard before it lands`,
    "Builders built this spec slice by slice on its integration branch. You did not build it: read its commit messages and diff as its one reviewer on the code standard; a reviewer on the spec reads it after you.",
    ...alone(changes),
    ...(red === undefined ? [] : ["## Its full check is red", `\`${CHECK}\` went red on this branch, so make it pass first. The end of its output:`, tailOf(red, TAIL_CAP)]),
    ...reviewedChange(changes.commits, changes.diff, changes.stat),
    ...linted(commitlint),
    "## Fix it",
    `${STANDARDS_LOADED} Where the code breaks the code standard, fix it here yourself: nothing goes back to a builder, and no one holds it to the code standard after you. ${TESTS_ARE_YOURS}`,
    `${COMMIT_WHY}${trailed(changes)}`,
    "## Your answer",
    ...answerAsked,
    "",
  ].join("\n\n");
}

export function onTheSpec(changes: Changes, { spec, title, body, commitlint }: { spec: string; title: string; body: string; commitlint: boolean }): string {
  return [
    `# Hold spec #${spec} to what it asks before it lands`,
    "Builders built the spec below slice by slice on its integration branch, and a reviewer has held it to the code standard. You did not build it: read the spec, its commit messages and its diff as its one reviewer on the spec.",
    ...alone(changes),
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    ...reviewedChange(changes.commits, changes.diff, changes.stat),
    ...linted(commitlint),
    "## Fix it",
    "Where the diff misses what the spec asks, builds what it rules out of scope, or leaves a sentence under `## I'll know it works when I can` with nothing on the running system to show it, fix it here yourself: nothing goes back to a builder. Once it lands, a fresh done check tries each of those sentences.",
    `${COMMIT_WHY}${trailed(changes)}`,
    "## Your answer",
    ...answerAsked,
    "",
  ].join("\n\n");
}

const shown = (shas: string[], ...args: string[]) => gitRead(["show", ...args, ...shas], UNREAD);

function changesToReview(): Changes[] {
  const diff = gitRead(["diff", FROM_MAIN], UNREAD);
  if (Buffer.byteLength(diff) <= DIFF_CAP) return [{ commits: gitRead(["log", "--reverse", COMMITS, PAST_MAIN], UNREAD), diff, stat: gitRead(["diff", "--stat", FROM_MAIN], UNREAD) }];
  const bySlice = new Map<string, string[]>();
  for (const line of gitRead(["log", "--reverse", "--format=%H%x00%(trailers:key=Slice,valueonly,separator=%x00)", PAST_MAIN], UNREAD).split("\n")) {
    const [sha = "", slice = UNSLICED] = line.split("\0");
    bySlice.set(slice, [...(bySlice.get(slice) ?? []), sha]);
  }
  return [...bySlice]
    .sort(([one], [other]) => Number(one === UNSLICED) - Number(other === UNSLICED))
    .map(([slice, shas]) => ({ slice, commits: shown(shas, "--no-patch", COMMITS), diff: shown(shas, "--format="), stat: shown(shas, "--format=", "--stat") }));
}

interface Reviewer {
  spend: (input: string, resume?: string) => Spent;
  session?: string;
  seat: string;
}

interface Finished {
  landed?: string;
  missed?: number[];
}

interface Approved {
  reason: string;
  steps: OwnerStep[];
}

interface Reviewed {
  reasons: string[];
  steps: Map<string, OwnerStep[]>;
  last: Reviewer;
}

function reviewed(spec: string, said: string, spent: Spent, app: AppKey | undefined): Approved | undefined {
  if (app !== undefined) freshAppToken(app, gh, `so the review of #${spec} is not acted on`);
  if (spent.refusal !== undefined) {
    stoppedAt("modelRun", `${said} ended red, ${spent.refusal}`);
    return undefined;
  }
  const answer = spent.answer as { outcome?: unknown; reason?: unknown; steps?: OwnerStep[] } | undefined;
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
  return { reason, steps: answer?.steps ?? [] };
}

function reviews(spec: string, said: string, app: AppKey | undefined, { title, body }: { title: string; body: string }): Reviewed | undefined {
  const commitlint = commitlinted();
  let red = checkedBy(CHECK);
  const reasons: string[] = [];
  const steps = new Map<string, OwnerStep[]>();
  let last: Reviewer | undefined;
  for (const on of ["code standard", "spec"] as const) {
    for (const [at, changes] of changesToReview().entries()) {
      const seat = `${spec}-${on === "spec" ? "spec" : "code"}-${at + 1}`;
      const spend = hire("finish", seat, { name: `reviewer on the ${on}`, model: "opus", answers: ANSWER });
      const spent = spend(on === "spec" ? onTheSpec(changes, { spec, title, body, commitlint }) : onTheCode(changes, { spec, red, commitlint }));
      red = undefined;
      const approved = reviewed(spec, said, spent, app);
      if (approved === undefined) return undefined;
      committed([`Review #${spec} on the ${on}`, trailer(changes)].filter((line) => line !== "").join("\n\n"), "fix");
      const slice = sliceNamed(changes);
      reasons.push(`On the ${on}${slice === undefined ? "" : `, ${slice}`}: ${approved.reason}`);
      steps.set(seat, approved.steps);
      last = { spend, session: spent.session, seat };
    }
  }
  return last === undefined ? undefined : { reasons, steps, last };
}

function landed(spec: string, said: string, app: AppKey | undefined, { reasons, steps, last }: Reviewed): string | undefined {
  let idle = false;
  for (;;) {
    const attempt = landing(["--spec", spec], reasons.join("\n\n"));
    if ("pr" in attempt) return attempt.pr;
    const before = head();
    const spent = last.spend(landRefused(attempt.refused), last.session);
    last.session = spent.session ?? last.session;
    const approved = reviewed(spec, said, spent, app);
    if (approved === undefined) return undefined;
    steps.set(last.seat, approved.steps);
    committed(`Fix what bin/land refused for #${spec}`, "fix");
    const changed = head() !== before;
    if (!changed && idle) {
      stoppedAt("unlanded", `${said} did not land, and two rounds in a row of its last reviewer changed nothing: ${quoted(attempt.refused.split("\n").at(-1) ?? "")}`);
      return undefined;
    }
    idle = !changed;
  }
}

const titled = (step: OwnerStep) => step.title.trim().toLowerCase();

function stepsFiled(spec: string, steps: OwnerStep[]): void {
  const once = steps.filter((step, at) => steps.findIndex((other) => titled(other) === titled(step)) === at);
  const refused = once.map(ownerStepFiled(`Left to the owner by the run that landed spec #${spec}.`)).filter(({ refusals }) => refusals.length > 0);
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
  const review = reviews(spec, said, app, asked);
  if (review === undefined) return {};
  const heldNow = heldOn(labelsHeld(spec, gh));
  if (heldNow !== undefined) {
    console.log(`${said} is marked ${heldNow}, so its reviewed branch does not land`);
    return {};
  }
  const pr = landed(spec, said, app, review);
  if (pr === undefined) return {};
  stepsFiled(spec, [...review.steps.values()].flat());
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
