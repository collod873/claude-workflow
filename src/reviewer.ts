import { spawnSync } from "node:child_process";
import { type AppKey, freshAppToken } from "./app-token.ts";
import { capped, handedDiff, LIST_CAP, NO_EM_DASH, sameFiles, TAIL_CAP, tailOf, TICKET_CAP } from "./brief.ts";
import { commentOnTicket, FOLLOW_UP_OF, gh, gitRead, heldOn, labelsHeld, machineBin, mark, post, REVIEW_LET_THROUGH } from "./post.ts";
import { CHECKING } from "./spelled.ts";
import { calledOwner, committed, commitlinted, FIXES_ASKED, type Fix, FOLLOW_UPS, followedUp, head, hire, linted, type OwnerStep, OWNER_STEPS } from "./stage.ts";
import { quoted } from "./ticket-shape.ts";

const ENDS = { fixed: "fixed here", owner: "asked of the owner", nothing: "needs nothing" } as const;

export const ROUTED = {
  fixes: FOLLOW_UPS.fixes,
  risks: {
    type: "array",
    items: {
      type: "object",
      properties: {
        risk: { type: "string", pattern: NO_EM_DASH },
        ends: { enum: Object.keys(ENDS) },
        why: { type: "string", pattern: NO_EM_DASH },
      },
      required: ["risk", "ends", "why"],
      additionalProperties: false,
    },
  },
};

export const ROUTED_REQUIRED = ["risks"];

interface Risk {
  risk: string;
  ends: keyof typeof ENDS;
  why: string;
}

export interface Routed {
  fixes?: Fix[];
  risks?: Risk[];
}

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

interface Answer extends Routed {
  outcome: "approve" | "stuck";
  reason: string;
  steps?: OwnerStep[];
}

function routedOn(routed: Routed[]): string[] {
  const ended = routed.flatMap(({ fixes = [], risks = [] }) => [
    ...fixes.map(({ fault, title }) => `- filed as the ticket "${title}" once it lands: ${fault}`),
    ...risks.map(({ risk, ends, why }) => `- ${ENDS[ends]}: ${risk} ${why}`),
  ]);
  return ended.length === 0 ? [] : [`Where each risk its reviewer saw ends:\n\n${ended.join("\n")}`];
}

export function firstTimeNamed(): (said: string) => boolean {
  const named = new Set<string>();
  return (said) => {
    const key = said.trim().toLowerCase();
    if (named.has(key)) return false;
    named.add(key);
    return true;
  };
}

export function routedFiled(found: string, routed: Routed[], call: { title: string; by: string }): ReturnType<typeof followedUp> {
  const unfiled = firstTimeNamed();
  const asks = routed.flatMap(({ risks = [] }) => risks.filter(({ ends }) => ends === "owner").map(({ risk, why }) => `${risk} ${why}`)).filter(firstTimeNamed());
  return [...routed.flatMap(({ fixes = [] }) => followedUp(found, fixes.filter(({ title }) => unfiled(title)), [], call)), ...followedUp(found, [], asks, call)];
}

export const approvedOn = (reviewed: string[], later: string[], routed: Routed[]) => [...reviewed, ...later.map((reason) => `After \`bin/land\` refused it: ${reason}`), ...routedOn(routed)].join("\n\n");

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

export const reviewedChange = (commits: string, diff: string, stat: string) => ["## Commits", capped(commits, LIST_CAP), "## Diff from main", handedDiff(diff, stat)];
export const TESTS_ARE_YOURS = "A new or changed test that would stay green on the bug it guards, or go red on a refactor that keeps the behavior, is yours to fix.";
export const STANDARDS_LOADED = "Before judging it, call the Skill tool with `coding-standards` for the code standard and `testing` for the test standard.";
export const COMMIT_WHY = "Commit what you change, each message saying why, with no em dash and no closing keyword such as `Fixes #12`.";
export const stuckAsked = (unit: "ticket" | "spec") => `- \`stuck\`: the work has a gap you cannot fix, one only the owner can close; \`reason\` says why, and the ${unit} is marked \`stuck\`.`;
export const STEPS_ASKED = "`steps`: each step only the owner can take before this work runs, such as a dashboard setting or a key, read from the finished work; name every one in each answer";

const builderSaid = (said: string) =>
  said.trim() === "" ? [] : ["## What its builder said", "The builder's closing notes, which reach the owner only through your answer: put each gap, wait, owner step or fault they name in `steps`, `fixes` or `risks`, as you would one you found.", capped(said, LIST_CAP)];

export function handedOn({ ticket, body, commits, diff, stat, alongside, said, commitlint }: Handed): string {
  return [
    `# Review #${ticket} before it lands`,
    "A builder built the ticket below on this branch, and its full check is green. You did not build it: read the ticket, its commit messages and the diff as its reviewer.",
    capped(body, TICKET_CAP),
    ...reviewedChange(commits, diff, stat),
    ...builderSaid(said),
    ...sameFiles(alongside),
    ...linted(commitlint),
    "## Fix it or approve it",
    `Where the diff misses the Why or its \`## Done when\`, or breaks what it touches, fix it here yourself: nothing goes back to the builder. ${TESTS_ARE_YOURS} A fault of the same cause in the code you read is yours to fix too when the fix is small, though the \`## Done when\` does not name it; a bigger one you name in \`fixes\` or \`risks\`. ${STANDARDS_LOADED}`,
    `${COMMIT_WHY} Answer one outcome:`,
    "- `approve`: it builds the Why, with whatever you fixed; `bin/land` then runs the full check and merges it, and anything it refuses comes back to you.",
    stuckAsked("ticket"),
    `${STEPS_ASKED}, since those of the answer that lands are each filed as an \`owner-step\` note, and the ticket still closes.`,
    `\`fixes\`: of the faults you saw and let through, ${FIXES_ASKED} filed once it lands.`,
    "`risks`: each other fault, cost or risk you saw, `risk` saying what it is and `ends` where it goes: `fixed` here, `why` saying how; `owner`, a call only the owner can make, `why` giving your pick, those of the answer that lands filed as one note to the owner; or `nothing`, `why` saying why it needs nothing.",
    "Your review is done once each fault, cost or risk you saw sits in `fixes` or `risks`; leave both empty only when you saw none. Name every one in each answer, since those of the answer that lands are the ones filed.",
    "`reason`: one paragraph for the owner on what the ticket built. An `approve`'s `reason` is commented on the ticket's PR before it merges, followed by each of your `fixes` and `risks` and where it ends.",
    "",
  ].join("\n\n");
}

const reviewedBy = (ticket: string) => `Review #${ticket} as its reviewer`;

export const ownerStepFiled = (left: string) => (step: OwnerStep) => ({ named: `${step.title}: ${step.why}`, ...post({ kind: "owner", title: step.title, text: `## Why\n\n${step.why}\n\n${left}\n` }, gh) });

function filedOnceLanded(ticket: string, answer: Answer): string {
  const filed = [
    ...(answer.steps ?? []).map(ownerStepFiled(`Left to the owner by the run that built #${ticket}, which closed.`)),
    ...routedFiled(`${FOLLOW_UP_OF}${ticket}${REVIEW_LET_THROUGH}`, [answer], { title: `Your call after #${ticket}'s review`, by: `#${ticket}'s reviewer` }),
  ];
  const refused = filed.filter(({ refusals }) => refusals.length > 0);
  if (refused.length > 0) commentOnTicket(ticket, [`What the reviewer of #${ticket} left that could not be filed:`, "", ...refused.map(({ named, refusals }) => `- ${named} (${quoted(refusals[0] ?? "")})`), ""].join("\n"), gh);
  return filed.length === 0 ? "" : `; filed: ${filed.map(({ said }) => said.trim()).filter((said) => said !== "").join(" ") || "none"}`;
}

export function landing(named: ["--ticket" | "--spec", string], reason: string): { pr: string } | { refused: string } {
  const landed = spawnSync(machineBin("land"), [...named, "--approved", reason], { encoding: "utf8", maxBuffer: Infinity });
  const pr = LANDED.exec(landed.stdout)?.[1];
  if (landed.status === 0 && pr !== undefined) return { pr };
  return { refused: tailOf(`${landed.stdout}${landed.stderr}`.trim(), TAIL_CAP) || `bin/land ended ${landed.status} and said nothing` };
}

export const landRefused = (refused: string) => ["`bin/land` refused to land it. Its output:", refused, "Fix what it names, commit, and answer again."].join("\n\n");

function triedAgainLater(ticket: string, refusal: string): number {
  console.error(`review: #${ticket} was not reviewed, as ${refusal}; its run ends red, so the machine re-runs it`);
  return 1;
}

export function reviewedAndLanded(ticket: string, { body, alongside, said }: { body: string; alongside: string; said: string }, app: AppKey | undefined): number {
  mark(ticket, CHECKING);
  const commits = gitRead(["log", "--reverse", "--format=- %s%n%n%b", "origin/main..HEAD"], "the commits past main could not be read, so nothing is reviewed");
  const diff = gitRead(["diff", "origin/main...HEAD"], "the diff from main could not be read, so nothing is reviewed");
  const stat = gitRead(["diff", "--stat", "origin/main...HEAD"], "the diff from main could not be read, so nothing is reviewed");
  const spend = hire("review", ticket, { name: "reviewer", model: "opus", answers: ANSWER });
  let input = handedOn({ ticket, body, commits, diff, stat, alongside, said, commitlint: commitlinted() });
  const reasons: string[] = [];
  let session: string | undefined;
  let idle = false;
  for (;;) {
    const before = head();
    const spent = spend(input, session);
    session = spent.session ?? session;
    if (spent.refusal !== undefined) return triedAgainLater(ticket, spent.refusal);
    if (app !== undefined) freshAppToken(app, gh, `so the review of #${ticket} is not acted on`);
    const answer = spent.answer as Answer | undefined;
    if (answer?.outcome === "stuck") return calledOwner(ticket, "reviewer", answer.reason);
    committed(reviewedBy(ticket), "fix");
    const changed = head() !== before;
    const held = heldOn(labelsHeld(ticket, gh));
    if (held !== undefined) {
      console.log(`review: #${ticket} is labelled ${held}, so it does not land; its branch is kept for its next run`);
      return 0;
    }
    if (answer !== undefined) reasons.push(answer.reason);
    const landed = answer === undefined ? { refused: "You gave no outcome. Answer one." } : landing(["--ticket", ticket], approvedOn(reasons.slice(0, 1), reasons.slice(1), [answer]));
    if ("pr" in landed) {
      const filed = answer === undefined ? "" : filedOnceLanded(ticket, answer);
      console.log(`review: #${ticket} landed as PR #${landed.pr}${filed}`);
      return spawnSync(machineBin("close"), [ticket, landed.pr], { stdio: "inherit" }).status ?? 1;
    }
    if (!changed && idle) return calledOwner(ticket, "reviewer", `two rounds in a row changed nothing: ${quoted(landed.refused.split("\n").at(-1) ?? "")}`);
    idle = !changed;
    input = answer === undefined ? landed.refused : landRefused(landed.refused);
  }
}
