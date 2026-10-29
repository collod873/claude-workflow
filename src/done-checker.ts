import { join } from "node:path";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, NO_EM_DASH, onDisk, tailOf } from "./brief.ts";
import { authoredOn, commentOnTicket, DONE_CHECK_MISSED, FOLLOW_UP_OF, followUpBody, FOREIGN, gh, mark, OWNER, post, readOrStop, STUCK, type Asked } from "./post.ts";
import { CONTRACT, opened, setupRefusal, type Spent } from "./stage.ts";
import { CHECKING, SPEC } from "./spelled.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { quoted, type Sentence, sentences, SPEC_CAP } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  notSpec: "Refused: the issue is not labelled `spec`, or the done check finds no sentence to try",
  unready: "Done check: the tree's setup from its contract fails, so nothing is tried",
});
export type Stop = ReturnType<typeof stoppedAt>;

const OUTCOMES = { held: "Held", missed: "Did not hold", owner: "Put to the owner", self: "Held" } as const;
type Outcome = keyof typeof OUTCOMES;

const TRIES = {
  type: "object",
  properties: {
    tries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentence: { type: "integer", minimum: 1 },
          outcome: { type: "string", enum: Object.keys(OUTCOMES) },
          tried: { type: "string", pattern: NO_EM_DASH },
        },
        required: ["sentence", "outcome", "tried"],
        additionalProperties: false,
      },
    },
  },
  required: ["tries"],
  additionalProperties: false,
};

interface Try {
  sentence: number;
  outcome: Outcome;
  tried: string;
}

export const REPLIES_CAP = 8 * 1024;
const WRITE_UP_MINUTES = 5;
export const OUT_OF_TIME = "Your time to try is up. Try nothing more. Answer now: every sentence you did not finish is `missed`, its `tried` saying what you saw and what was left to try.\n";

const answered = (replies: string) =>
  replies === "" ? [] : ["## The owner's replies since the last done check", tailOf(replies, REPLIES_CAP), "Where the owner says a sentence held or did not, his word is its try."];

const RUNNING_HERE =
  "For this repo the running system is the landed code in this checkout, which no Actions run has used yet: run its stages against stand-ins, such as a throwaway clone and a fake `gh`, and read its earlier Actions runs and the issues and PRs they touched with `gh` for how it behaves live. What only a live run can show goes to the owner.";
const BROWSER =
  "Settle what a sentence rests on by calling the app's server directly, its routes and actions, which answers in a fraction of a second, and open a page only for what the page itself must show. Drive one page at a time with `ui-check` (`ui-check open <url>`, `goto`, `click`, `eval`, `screenshot`, `--device`). To try sentences that do not depend on each other side by side, or a flow `ui-check` cannot script, open them as pages of one Playwright script that requires `$(npm root -g)/playwright-core` and launches `channel: \"chrome\"`. Install no browser or driver of your own. `tools <words>` finds any other tool here.";
const RUNNING_THERE = `Here the running system is this checkout of the repo, readied by its contract's setup, and its Actions runs and the issues and PRs they touched, read with \`gh\`.\n\n${BROWSER}`;
const SELF =
  " `self`, without trying it, for a sentence about the spec closing itself or the owner being told which sentence did not hold: this run is the one that closes the spec and files each miss, so the machine settles it from the other sentences.";

const numbered = (listed: Sentence[]) => listed.map(({ said }, at) => `${at + 1}. ${said}`).join("\n");

export function handedOn(title: string, body: string, { replies = "", foreign = false }: { replies?: string; foreign?: boolean } = {}): string {
  return [
    `Try each sentence under \`## The sentences to try\` on the running system, not on its tests, and say how each came out. Read and run what you need, and leave the repo and GitHub as they are. ${foreign ? RUNNING_THERE : RUNNING_HERE}`,
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    ...answered(replies),
    "## The sentences to try",
    capped(numbered(sentences(body)), SPEC_CAP),
    "## Your answer",
    `\`tries\`: one item per sentence, \`sentence\` its number in that list. \`outcome\`: \`held\` when you saw it hold whole; \`missed\` when you saw any part of it fail that you could try here; \`owner\` for only the part the owner alone can try, since it needs the owner's phone, eyes or a real customer, or a key, account or live service this checkout lacks.${foreign ? "" : SELF} \`tried\`: what you did to try it and what you saw; for \`missed\`, also where it broke as far as you saw, since it becomes the bug that fixes it; for \`owner\`, what is missing and what the owner should do to try it.`,
    "",
  ].join("\n\n");
}

const isTry = (given: unknown): given is Try => {
  const one = given as Partial<Try> | undefined;
  return typeof one?.sentence === "number" && typeof one.tried === "string" && typeof one.outcome === "string" && one.outcome in OUTCOMES;
};

const DONE_CHECK_HEADING = "## Done check";

const posted = (tried: [number, string, Try][], after: string[] = []) =>
  [DONE_CHECK_HEADING, "", ...tried.map(([number, sentence, one]) => `${number}. **${OUTCOMES[one.outcome]}**: ${sentence}\n   ${one.tried}`), ...after.flatMap((line) => ["", line]), ""].join("\n");

const listing = (missed: [number, string, Try][], between: string) => missed.map(([number]) => number).join(between);
const closedWith = (putToOwner: [number, string, Try][]) => `Closed with sentence ${listing(putToOwner, ", ")} put to the owner: each says what the owner could try, and the owner files a miss he sees live as a new ticket.`;

interface Read {
  issue: string;
  said: string;
  asked: Asked;
  replies: string;
  listed: Sentence[];
  spend: (input: string) => Spent;
}

const NOTHING_POSTED = (issue: string) => `Nothing was posted, so once its cause is fixed the done check is safe to run again on its own: \`bin/done-check ${issue}\` on a checkout of main, with \`${STUCK}\` off.`;

function calledOwner({ issue, said }: Pick<Read, "issue" | "said">, stop: Stop, why: string, next = NOTHING_POSTED(issue)): Stop {
  mark(issue, STUCK);
  commentOnTicket(issue, `@${OWNER} the done check of #${issue} stopped and needs you: ${why}. ${next}`, gh);
  return stoppedAt(stop, `${said} marked ${STUCK}, ${why}`);
}

function read(issue: string): Read | Stop | undefined {
  const said = `done-check: #${issue}`;
  const opening = opened({
    stage: "done-check",
    issue,
    state: CHECKING,
    stoppedAt,
    hire: { name: "done checker", model: "opus", answers: TRIES, writeUp: { minutes: WRITE_UP_MINUTES, told: OUT_OF_TIME } },
    ready: (asked) => {
      if (!asked.labels.has(SPEC)) return stoppedAt("notSpec", `${said} is not a spec, so nothing was tried`);
      const listed = sentences(asked.body);
      if (listed.length === 0) return stoppedAt("notSpec", `${said} carries no sentence to try, so nothing was tried or closed`);
      return { carrying: { listed, authored: authoredOn(issue, `#${issue} could not read its comments, so nothing was tried`, gh) } };
    },
  });
  if (typeof opening !== "object") return opening;
  const unready = setupRefusal(onDisk(join(process.cwd(), CONTRACT)) ?? "");
  if (unready !== undefined) return calledOwner({ issue, said }, "unready", `its tree's setup failed: ${quoted(unready)}`);
  const { asked, spend, carried: { listed, authored } } = opening;
  const since = authored.map(({ body }) => body.startsWith(DONE_CHECK_HEADING)).lastIndexOf(true);
  const replies = since === -1 ? "" : authored.slice(since + 1).flatMap(({ author, body }) => (author === OWNER ? [body] : [])).join("\n\n");
  return { issue, said, asked, replies, listed, spend };
}

function tried(spec: Read, app: AppKey | undefined): [number, string, Try][] | Stop {
  const { issue, asked, replies, listed, spend } = spec;
  if (app !== undefined) freshAppToken(app, gh, `so the done check of #${issue} is not tried`);
  const spent = spend(handedOn(asked.title, asked.body, { replies, foreign: FOREIGN }));
  if (app !== undefined) freshAppToken(app, gh, `so the done check of #${issue} is not posted`);
  if (spent.refusal !== undefined) return calledOwner(spec, "modelRun", spent.refusal);
  const given = (spent.answer as { tries?: unknown } | undefined)?.tries;
  const tries = Array.isArray(given) ? given.filter(isTry) : [];
  const found: [number, string, Try][] = [];
  for (const [at, { said: sentence }] of listed.entries()) {
    const one = tries.find((each) => each.sentence === at + 1);
    if (one === undefined) return calledOwner(spec, "modelRun", `the done checker gave no try for sentence ${at + 1}`);
    found.push([at + 1, sentence, one]);
  }
  return found;
}

function commented(spec: Read, text: string): { url: string } | Stop {
  const comment = commentOnTicket(spec.issue, text, gh);
  const [refusal] = comment.refusals;
  return refusal === undefined ? { url: comment.said } : calledOwner(spec, "unrecorded", `its comment would not post: ${quoted(refusal)}`);
}

const SELF_SETTLED = {
  missed: "This run files each other sentence that did not hold as a bug, and closed the spec.",
  owner: "This run closed the spec, since every other sentence held or was put to the owner.",
  held: "This run closed the spec, since every other sentence held.",
};

const settled = (found: [number, string, Try][]): [number, string, Try][] => {
  const others = found.map(([, , one]) => one.outcome);
  const tried = SELF_SETTLED[others.includes("missed") ? "missed" : others.includes("owner") ? "owner" : "held"];
  return found.map(([number, sentence, one]) => [number, sentence, one.outcome === "self" ? { ...one, tried } : one]);
};

export interface Checked {
  missed: number[];
}

export function doneCheck(issue: string, app: AppKey | undefined): Checked | Stop | undefined {
  const spec = read(issue);
  if (typeof spec !== "object") return spec;
  const tries = tried(spec, app);
  if (!Array.isArray(tries)) return tries;
  const found = settled(tries);
  const { said } = spec;
  const missed = found.filter(([, , one]) => one.outcome === "missed");
  const putToOwner = found.filter(([, , one]) => one.outcome === "owner");
  const comment = commented(spec, posted(found, missed.length > 0 || putToOwner.length === 0 ? [] : [closedWith(putToOwner)]));
  if (typeof comment === "string") return comment;
  const filed = missed.map(([number, sentence, one]) => ({ number, ...post({ kind: "bug", title: quoted(sentence), text: followUpBody([`${FOLLOW_UP_OF}${issue}${DONE_CHECK_MISSED}`, "", `> ${one.tried}`], [sentence]) }, gh) }));
  const refused = filed.find(({ refusals }) => refusals.length > 0);
  if (refused !== undefined) return calledOwner(spec, "unrecorded", `sentence ${refused.number} did not hold and would not file as a bug: ${quoted(refused.refusals[0] ?? "")}`, `Its comment is posted: file each miss as a bug and close #${issue} by hand.`);
  const held =
    missed.length > 0
      ? `did not hold sentence ${listing(missed, ", ")}, filed as ${filed.map(({ said }) => said.trim()).join(", ")},`
      : putToOwner.length === 0
        ? "held every sentence"
        : "held every sentence it could try, put the rest to the owner,";
  if (gh(["issue", "close", issue, "--reason", "completed"]).status !== 0) return calledOwner(spec, "unrecorded", `it ${held} but would not close: ${comment.url}`, `Its comment is posted, so nothing is left to try: close #${issue} by hand.`);
  console.log(`${said} ${held} and is closed: ${comment.url}`);
  return { missed: missed.map(([number]) => number) };
}

if (import.meta.main) {
  const [issue] = process.argv.slice(2);
  if (issue === undefined) throw new Error("no issue number in the arguments");
  const ended = readOrStop("done-check", () => doneCheck(issue, takenAppKey()));
  process.exit(exitFor(typeof ended === "string" ? ended : undefined));
}
