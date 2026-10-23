import { join } from "node:path";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, NO_EM_DASH, onDisk } from "./brief.ts";
import { authoredOn, commentOnTicket, commentsRead, FOREIGN, gh, OWNER, readOrStop, type Asked } from "./post.ts";
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

const answered = (replies: string) =>
  replies === "" ? [] : ["## The owner's replies since the last done check", capped(replies, REPLIES_CAP), "Where the owner says a sentence held or did not, his word is its try."];

const RUNNING_HERE = "For this repo the running system is its own Actions runs and the issues and PRs they touched, read with `gh`.";
const BROWSER = "Settle what a sentence rests on by calling the app's server directly, its routes and actions, which answers in a fraction of a second, and open a page only for what the page itself must show. For a page, drive the one headless browser `ui-check` keeps running (`ui-check open <url>`, `goto`, `click`, `eval`, `screenshot`, `--device`); for a flow it cannot script, write a Playwright script that requires `$(npm root -g)/playwright-core` and launches `channel: \"chrome\"`. Install no browser or driver of your own. Try sentences that do not depend on each other side by side, in pages of one browser. `tools <words>` finds any other tool here.";
const RUNNING_THERE = `Here the running system is this checkout of the repo, readied by its contract's setup, and its Actions runs and the issues and PRs they touched, read with \`gh\`. ${BROWSER}`;

export function handedOn(title: string, body: string, { replies = "", foreign = false }: { replies?: string; foreign?: boolean } = {}): string {
  return [
    `Try each sentence under \`## I'll know it works when I can\` in this spec on the running system, not on its tests, and say how each came out. ${foreign ? RUNNING_THERE : RUNNING_HERE} Read and run what you need, and leave the repo and GitHub as they are.`,
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    ...answered(replies),
    "## Your answer",
    "`tries`: one item per sentence, `sentence` its number counting from 1 in the order the spec lists them. `outcome`: `held` when you saw it hold, `missed` when you saw it fail, `owner` when only the owner can try it, needing the owner's phone, eyes or a real customer. `self`, without trying it, for a sentence about the spec closing itself or the owner being told which sentence did not hold: this run is the one that closes the spec or names the miss, so the machine settles it from the other sentences. `tried`: what you did to try it and what you saw, or for `owner`, what the owner should do to try it.",
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
const CLOSED_WITH = "Closed with sentence";
const closedWith = (putToOwner: [number, string, Try][]) => `${CLOSED_WITH} ${listing(putToOwner, ", ")} put to the owner: each says what the owner could try, and a miss seen live is filed as a new ticket.`;

export const WAVE_CHECK_HEADING = "## Wave check";
const waveLine = (number: number | string, outcome: string) => `- Sentence ${number}, **${outcome}**`;
const givenIn = (outcome: string) => {
  const line = new RegExp(`^${waveLine("(\\d+)", outcome).replaceAll("*", "\\*")}`, "gm");
  return (waveCheck: string) => new Set([...waveCheck.matchAll(line)].map(([, number]) => Number(number)));
};
export const missedIn = givenIn(OUTCOMES.missed);
const heldAtWave = givenIn(OUTCOMES.held);
const HELD_AT_DONE = new RegExp(`^(\\d+)\\. \\*\\*${OUTCOMES.held}\\*\\*:`, "gm");
const heldAtDone = (doneCheck: string) => new Set([...doneCheck.matchAll(HELD_AT_DONE)].map(([, number]) => Number(number)));

export const heldBefore = (comments: string[]): number[] =>
  [...new Set(comments.flatMap((comment) => [...(comment.startsWith(WAVE_CHECK_HEADING) ? heldAtWave(comment) : comment.startsWith(DONE_CHECK_HEADING) ? heldAtDone(comment) : [])]))].sort((one, other) => one - other);

interface Read {
  issue: string;
  said: string;
  asked: Asked;
  replies: string;
  listed: Sentence[];
  spend: (input: string) => Spent;
}

function read(issue: string): Read | Stop | undefined {
  const said = `done-check: #${issue}`;
  const opening = opened({
    stage: "done-check",
    issue,
    state: CHECKING,
    stoppedAt,
    hire: { name: "done checker", model: "opus", answers: TRIES },
    ready: (asked) => {
      if (!asked.labels.has(SPEC)) return stoppedAt("notSpec", `${said} is not a spec, so nothing was tried`);
      const listed = sentences(asked.body);
      if (listed.length === 0) return stoppedAt("notSpec", `${said} carries no sentence to try, so nothing was tried or closed`);
      return { carrying: { listed, authored: authoredOn(issue, `#${issue} could not read its comments, so nothing was tried`, gh) } };
    },
  });
  if (typeof opening !== "object") return opening;
  const unready = setupRefusal(onDisk(join(process.cwd(), CONTRACT)) ?? "");
  if (unready !== undefined) return stoppedAt("unready", `${said} ended red, its tree's setup failed: ${quoted(unready)}`);
  const { asked, spend, carried: { listed, authored } } = opening;
  const since = authored.map(({ body }) => body.startsWith(DONE_CHECK_HEADING)).lastIndexOf(true);
  const replies = since === -1 ? "" : authored.slice(since + 1).flatMap(({ author, body }) => (author === OWNER ? [body] : [])).join("\n\n");
  return { issue, said, asked, replies, listed, spend };
}

function tried({ issue, said, asked, replies, listed, spend }: Read, app: AppKey | undefined): [number, string, Try][] | Stop {
  const spent = spend(handedOn(asked.title, asked.body, { replies, foreign: FOREIGN }));
  if (app !== undefined) freshAppToken(app, gh, `so the done check of #${issue} is not posted`);
  if (spent.refusal !== undefined) return stoppedAt("modelRun", `${said} ended red, ${spent.refusal}`);
  const given = (spent.answer as { tries?: unknown } | undefined)?.tries;
  const tries = Array.isArray(given) ? given.filter(isTry) : [];
  const found: [number, string, Try][] = [];
  for (const [at, { said: sentence }] of listed.entries()) {
    const one = tries.find((each) => each.sentence === at + 1);
    if (one === undefined) return stoppedAt("modelRun", `${said} ended red, the done checker gave no try for sentence ${at + 1}`);
    found.push([at + 1, sentence, one]);
  }
  return found;
}

function commented({ issue, said }: Read, text: string): { url: string } | Stop {
  const comment = commentOnTicket(issue, text, gh);
  const [refusal] = comment.refusals;
  return refusal === undefined ? { url: comment.said } : stoppedAt("unrecorded", `${said} ended red, its comment would not post: ${quoted(refusal)}`);
}

const SELF_SETTLED = {
  missed: "This run names each other sentence that did not hold, and why.",
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
  if (missed.length > 0) {
    console.log(`${said} did not hold sentence ${listing(missed, ", ")}, so it stays open: ${comment.url}`);
    return { missed: missed.map(([number]) => number) };
  }
  const held = putToOwner.length === 0 ? "held every sentence" : "held every sentence it could try, put the rest to the owner,";
  if (gh(["issue", "close", issue, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `${said} ${held} but would not close: ${comment.url}`);
  console.log(`${said} ${held} and is closed: ${comment.url}`);
  return { missed: [] };
}

function askedOwner(issue: string): undefined {
  const comments = commentsRead(issue, `#${issue} could not read its comments, so nothing was asked`, gh);
  const last = comments.filter((comment) => comment.startsWith(DONE_CHECK_HEADING)).at(-1) ?? "";
  console.log(String(last.includes(`**${OUTCOMES.owner}**`) && !last.includes(`\n${CLOSED_WITH} `)));
  return undefined;
}

if (import.meta.main) {
  const [issue, flag] = process.argv.slice(2);
  if (issue === undefined) throw new Error("no issue number in the arguments");
  const ended = readOrStop("done-check", () => (flag === "--asked" ? askedOwner(issue) : doneCheck(issue, takenAppKey())));
  process.exit(exitFor(typeof ended === "string" ? ended : undefined));
}
