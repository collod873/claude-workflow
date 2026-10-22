import { spawnSync } from "node:child_process";
import { capped, handedDiff, LIST_CAP, NO_EM_DASH, sameFiles, TAIL_CAP, tailOf, TICKET_CAP } from "./brief.ts";
import { commentOnTicket, gh, gitRead, heldOn, labelsHeld, machineBin, mark, post } from "./post.ts";
import { CHECKING } from "./spelled.ts";
import { calledOwner, committed, commitlinted, head, hire, linted, type OwnerStep, OWNER_STEPS } from "./stage.ts";
import { quoted } from "./ticket-shape.ts";

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["approve", "stuck"] },
    reason: { type: "string", pattern: NO_EM_DASH },
    steps: OWNER_STEPS,
  },
  required: ["outcome", "reason"],
  additionalProperties: false,
};

interface Answer {
  outcome: "approve" | "stuck";
  reason: string;
  steps?: OwnerStep[];
}

const LANDED = /^Landed \S+\/pull\/(\d+)/m;

interface Handed {
  ticket: string;
  body: string;
  commits: string;
  diff: string;
  stat: string;
  alongside: string;
  commitlint: boolean;
}

export function handedOn({ ticket, body, commits, diff, stat, alongside, commitlint }: Handed): string {
  return [
    `# Review #${ticket} before it lands`,
    "A builder built the ticket below on this branch, and its full check is green. You did not build it: read the ticket, its commit messages and the diff as its reviewer.",
    capped(body, TICKET_CAP),
    "## Commits",
    capped(commits, LIST_CAP),
    "## Diff from main",
    handedDiff(diff, stat),
    ...sameFiles(alongside),
    ...linted(commitlint),
    "## Fix it or approve it",
    "Where the diff misses the Why or its `## Done when`, or breaks what it touches, fix it here yourself: nothing goes back to the builder. A new or changed test that would stay green on the bug it guards, or go red on a refactor that keeps the behavior, is yours to fix. Before judging it, call the Skill tool with `coding-standards` for the code standard and `testing` for the test standard.",
    "Commit what you change, each message saying why, with no em dash and no closing keyword such as `Fixes #12`. Answer one outcome:",
    "- `approve`: it builds the Why, with whatever you fixed; `bin/land` then runs the full check and merges it, and anything it refuses comes back to you.",
    "- `stuck`: the work has a gap you cannot fix, one only the owner can close; `reason` says why, and the ticket is marked `stuck`.",
    "`steps`: each step only the owner can take before this work runs, such as a dashboard setting or a key, read from the finished work; name every one in each answer, since those of the answer that lands are each filed as an `owner-step` note, and the ticket still closes.",
    "`reason`: one paragraph for the owner. An `approve`'s `reason` is commented on the ticket's PR before it merges: name in it every cost or risk you saw and let through, or say you saw none.",
    "",
  ].join("\n\n");
}

const reviewedBy = (ticket: string) => `Review #${ticket} as its reviewer`;

const stepBody = (ticket: string, { why }: OwnerStep) => `## Why\n\n${why}\n\nLeft to the owner by the run that built #${ticket}, which closed.\n`;

function filedSteps(ticket: string, steps: OwnerStep[]): string {
  const filed = steps.map((step) => ({ step, ...post({ kind: "owner", title: step.title, text: stepBody(ticket, step) }, gh) }));
  const refused = filed.filter(({ refusals }) => refusals.length > 0);
  if (refused.length > 0) commentOnTicket(ticket, ["These steps only the owner can take could not be filed as notes:", "", ...refused.map(({ step, refusals }) => `- ${step.title}: ${step.why} (${quoted(refusals[0] ?? "")})`), ""].join("\n"), gh);
  return filed.length === 0 ? "" : `; owner steps filed: ${filed.map(({ said }) => said.trim()).filter((said) => said !== "").join(" ") || "none"}`;
}

function landing(ticket: string, reason: string): { pr: string } | { refused: string } {
  const landed = spawnSync(machineBin("land"), ["--ticket", ticket, "--approved", reason], { encoding: "utf8", maxBuffer: Infinity });
  const pr = LANDED.exec(landed.stdout)?.[1];
  if (landed.status === 0 && pr !== undefined) return { pr };
  return { refused: tailOf(`${landed.stdout}${landed.stderr}`.trim(), TAIL_CAP) || `bin/land ended ${landed.status} and said nothing` };
}

const landRefused = (refused: string) => ["`bin/land` refused to land it. Its output:", refused, "Fix what it names, commit, and answer again."].join("\n\n");

function triedAgainLater(ticket: string, refusal: string): number {
  console.error(`review: #${ticket} was not reviewed, as ${refusal}; its run ends red, so the machine re-runs it`);
  return 1;
}

export function reviewedAndLanded(ticket: string, body: string, alongside: string): number {
  mark(ticket, CHECKING);
  const commits = gitRead(["log", "--reverse", "--format=- %s%n%n%b", "origin/main..HEAD"], "the commits past main could not be read, so nothing is reviewed");
  const diff = gitRead(["diff", "origin/main...HEAD"], "the diff from main could not be read, so nothing is reviewed");
  const stat = gitRead(["diff", "--stat", "origin/main...HEAD"], "the diff from main could not be read, so nothing is reviewed");
  const spend = hire("review", ticket, { name: "reviewer", model: "opus", answers: ANSWER });
  let input = handedOn({ ticket, body, commits, diff, stat, alongside, commitlint: commitlinted() });
  let session: string | undefined;
  let idle = false;
  for (;;) {
    const before = head();
    const spent = spend(input, session);
    session = spent.session ?? session;
    if (spent.refusal !== undefined) return triedAgainLater(ticket, spent.refusal);
    const answer = spent.answer as Answer | undefined;
    if (answer?.outcome === "stuck") return calledOwner(ticket, "reviewer", answer.reason);
    committed(reviewedBy(ticket), "fix");
    const changed = head() !== before;
    const held = heldOn(labelsHeld(ticket, gh));
    if (held !== undefined) {
      console.log(`review: #${ticket} is labelled ${held}, so it does not land; its branch is kept for its next run`);
      return 0;
    }
    const landed = answer === undefined ? { refused: "You gave no outcome. Answer one." } : landing(ticket, answer.reason);
    if ("pr" in landed) {
      const filed = filedSteps(ticket, answer?.steps ?? []);
      console.log(`review: #${ticket} landed as PR #${landed.pr}${filed}`);
      return spawnSync(machineBin("close"), [ticket, landed.pr], { stdio: "inherit" }).status ?? 1;
    }
    if (!changed && idle) return calledOwner(ticket, "reviewer", `two rounds in a row changed nothing: ${quoted(landed.refused.split("\n").at(-1) ?? "")}`);
    idle = !changed;
    input = answer === undefined ? landed.refused : landRefused(landed.refused);
  }
}
