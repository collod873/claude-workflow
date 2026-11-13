import { spawnSync } from "node:child_process";
import { type AppKey, freshAppToken } from "./app-token.ts";
import { capped, DIFF_CAP, diffOverCap, LIST_CAP, NO_EM_DASH, TAIL_CAP, tailOf, TICKET_CAP } from "./brief.ts";
import { calledOwner, type Caller, commentOnTicket, fromHere, fromLine, gh, gitRead, standingOn, stoodDown, machineBin, mark } from "./post.ts";
import { CHECKING } from "./spelled.ts";
import { type Answered, approvedOn, filed, type FollowUps, gathered, MOST_FIXES, OWNER_STEPS, ROUTED, ROUTED_REQUIRED, stepsUnfileable } from "./follow-ups.ts";
import { committed, commitlinted, head, hireIn, stageLoop } from "./stage.ts";
import { quoted } from "./ticket-shape.ts";

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["approve", "stuck"] },
    reason: { type: "string", pattern: NO_EM_DASH },
    steps: OWNER_STEPS,
    ...ROUTED,
  },
  required: ["outcome", "reason", ...ROUTED_REQUIRED],
  additionalProperties: false,
};

interface Answer extends Answered {
  outcome: "approve" | "stuck";
  reason: string;
}

export const afterRefused = (reason: string) => `After \`bin/land\` refused it: ${reason}`;

const LANDED = /^Landed \S+\/pull\/(\d+)/m;

interface Handed {
  ticket: string;
  body: string;
  commits: string;
  diff: string;
  stat: string;
  alongside: string;
  said: string;
  commitlint: boolean;
}

function diffHanded(diff: string, stat: string): string {
  const over = diffOverCap(diff, stat, DIFF_CAP);
  return over === undefined
    ? diff
    : [`The diff runs ${over.bytes} bytes, past the ${DIFF_CAP} you can be handed, so it reaches you as its \`git diff --stat\` and a list of changed files; read the rest in the repo as you need it.`, over.stat, "Every file changed:", over.files].join("\n\n");
}

const alongsideSection = (alongside: string) =>
  alongside === "" ? [] : ["## Open tickets on the same files", "Each shares a file with this ticket, and may already own a fault you would otherwise file:", capped(alongside, LIST_CAP)];

const builderSaid = (said: string) =>
  said.trim() === "" ? [] : ["## What its builder said", "The builder's closing notes, which reach the owner only through your answer: put each gap, wait, owner step or fault they name in `steps`, `fixes` or `risks`, as you would one you found.", capped(said, LIST_CAP)];

export function handedOn({ ticket, body, commits, diff, stat, alongside, said, commitlint }: Handed): string {
  return [
    `# Review #${ticket} before it lands`,
    "A builder built the ticket below on this branch, and its full check is green. You did not build it: read the ticket, its commit messages and the diff as its reviewer.",
    capped(body, TICKET_CAP),
    "## Commits",
    capped(commits, LIST_CAP),
    "## Diff from main",
    diffHanded(diff, stat),
    ...builderSaid(said),
    ...alongsideSection(alongside),
    ...(commitlint ? ["This repo runs commitlint on every commit, yours too: write each message as a conventional `type: subject`, such as `fix: keep the zone`, the subject lower-case."] : []),
    "## Fix it or approve it",
    "Before judging it, call the Skill tool with `coding-standards` for the code standard and `testing` for the test standard. You are the last engineer on this code before it ships, so each fault you find is yours to fix on this branch, kept small: a gap in the Why or its `## Done when`, a break in what it touches, a new or changed test that fails one of the `testing` skill's checks, a fault of the same cause in the code you read. Settle every open choice yourself, the way a senior engineer the owner hired would.",
    "Commit each change you make with its reason as the message; `bin/land` refuses an em dash or a closing keyword such as `Fixes #12`. Answer one outcome:",
    "- `approve`: it builds the Why, with whatever you fixed; `bin/land` then runs the full check and merges it, and anything it refuses comes back to you.",
    "- `stuck`: the work has a gap only the owner can close, and you cannot fix it; give the why in `reason`, and the ticket goes `stuck`.",
    "`steps`: each step only the owner can take before this work runs, such as a dashboard setting or a key, read from the finished work; each one named is filed as an `owner-step` note once it lands, and the ticket still closes. Its `needs` names the file, setting or env variable that reads what the step provides, such as `RESEND_API_KEY` read in `src/mail.ts`; a step whose `needs` is empty is filed as a plain note and holds no fix.",
    "A fix you file that cannot build before the owner takes one of your `steps` carries that step's exact title in `waits`, so it waits on the step's note and builds once he closes it; keep the fix out of the step's `why`.",
    `\`fixes\`: up to ${MOST_FIXES} faults this branch cannot carry, in another repo or in code this work leaves untouched and too big to fix here, each with one sure fix: \`fault\` with its evidence, \`title\`, and \`done\` naming the sentences that hold after the fix; each is filed as a ticket once it lands.`,
    "`risks`: each other fault, cost or risk you saw, `risk` saying what it is and `ends` where it went: `fixed` here, `why` saying how; or `nothing`, `why` saying why it can stand. The owner hears from your review through `steps` alone.",
    "Your review is done once each fault, cost or risk you saw sits in `fixes` or `risks`; leave both empty only when you saw none. Each answer adds to what you named before, so after the first name only what is new or has changed its end.",
    "`reason`: one paragraph for the owner on what the ticket built. An `approve`'s `reason` is commented on the ticket's PR before it merges, followed by each of your `fixes` and `risks` and where it ends.",
    "",
  ].join("\n\n");
}

const reviewedBy = (ticket: string) => `Review #${ticket} as its reviewer`;
const reviewerCaller = (ticket: string): Caller => ({ who: "the reviewer", said: `fix: #${ticket} needs the owner` });

function filedOnceLanded(ticket: string, named: FollowUps): string {
  const followUps = filed(named, { found: fromLine(fromHere(ticket), "review"), left: `Left to the owner by the run that built #${ticket}, which closed.` });
  const refused = followUps.filter(({ refusals }) => refusals.length > 0);
  if (refused.length > 0) commentOnTicket(ticket, [`What the reviewer of #${ticket} left that could not be filed:`, "", ...refused.map(({ named, refusals }) => `- ${named} (${quoted(refusals[0] ?? "")})`), ""].join("\n"), gh);
  return followUps.length === 0 ? "" : `; filed: ${followUps.map(({ said }) => said.trim()).filter((said) => said !== "").join(" ") || "none"}`;
}

export function landing(named: ["--ticket" | "--spec", string], reason: string): { pr: string } | { refused: string } {
  const landed = spawnSync(machineBin("land"), [...named, "--approved", reason], { encoding: "utf8", maxBuffer: Infinity });
  const pr = LANDED.exec(landed.stdout)?.[1];
  if (landed.status === 0 && pr !== undefined) return { pr };
  return { refused: tailOf(`${landed.stdout}${landed.stderr}`.trim(), TAIL_CAP) || `bin/land ended ${landed.status} and said nothing` };
}

export const idleTwice = (refused: string) => `two rounds in a row changed nothing: ${quoted(refused.split("\n").at(-1) ?? "")}`;

const landRefused = (refused: string) => ["`bin/land` refused to land it. Its output:", refused, "Fix what it names, commit, and answer again."].join("\n\n");

function triedAgainLater(ticket: string, refusal: string): number {
  console.error(`review: #${ticket} was not reviewed, as ${refusal}; its run ends red, so the machine re-runs it`);
  return 1;
}

export async function reviewedAndLanded(ticket: string, { body, alongside, said }: { body: string; alongside: string; said: string }, app: AppKey | undefined): Promise<number> {
  mark(ticket, CHECKING);
  const commits = gitRead(["log", "--reverse", "--format=- %s%n%n%b", "origin/main..HEAD"], "the commits past main could not be read, so nothing is reviewed");
  const diff = gitRead(["diff", "origin/main...HEAD"], "the diff from main could not be read, so nothing is reviewed");
  const stat = gitRead(["diff", "--stat", "origin/main...HEAD"], "the diff from main could not be read, so nothing is reviewed");
  const spend = hireIn(process.cwd(), "review", ticket, { name: "reviewer", model: "opus", effort: "medium", answers: ANSWER });
  const input = handedOn({ ticket, body, commits, diff, stat, alongside, said, commitlint: commitlinted() });
  const reasons: string[] = [];
  let named: FollowUps | undefined;
  let before = "";
  const looped = await stageLoop<number>({
    spend: (handed, session) => {
      before = head();
      return spend(handed, session);
    },
    input,
    stops: ["unchanged"],
    judged: (spent) => {
      if (spent.refusal !== undefined) return { done: triedAgainLater(ticket, spent.refusal) };
      if (app !== undefined) freshAppToken(app, gh, `so the review of #${ticket} is not acted on`);
      const answer = spent.answer as Answer | undefined;
      if (answer?.outcome === "stuck") return { done: calledOwner(ticket, reviewerCaller(ticket), answer.reason) };
      committed(reviewedBy(ticket), "fix");
      const changed = head() !== before;
      const stood = stoodDown(standingOn(ticket, gh));
      if (stood !== undefined) {
        console.log(`review: #${ticket} ${stood}, so it does not land; its branch is kept for its next run`);
        return { done: 0 };
      }
      if (answer !== undefined) {
        reasons.push(answer.reason);
        named = gathered(named, answer);
      }
      const unfileable = stepsUnfileable(named?.steps ?? []);
      const landed = named === undefined ? { refused: "You gave no outcome. Answer one." } : unfileable !== undefined ? { refused: unfileable } : landing(["--ticket", ticket], approvedOn([...reasons.slice(0, 1), ...reasons.slice(1).map(afterRefused)], named));
      if ("pr" in landed) {
        const filed = named === undefined ? "" : filedOnceLanded(ticket, named);
        console.log(`review: #${ticket} landed as PR #${landed.pr}${filed}`);
        return { done: 0 };
      }
      return { refused: landed.refused, handBack: answer === undefined || unfileable !== undefined ? landed.refused : landRefused(landed.refused), changed };
    },
  });
  return "done" in looped ? looped.done : calledOwner(ticket, reviewerCaller(ticket), idleTwice(looped.refused));
}
