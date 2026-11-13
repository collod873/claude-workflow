import { postedUnderOrigin } from "./issue-links.ts";
import { join } from "node:path";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, listedCapped, NO_EM_DASH, onDisk, tailOf } from "./brief.ts";
import { askedOn, authoredOn, calledOwner, commentOnTicket, endedRed, followUpBody, fromHere, fromLine, FOREIGN, gh, OWNER, readOrStop, STUCK, stoodDown, type Asked } from "./post.ts";
import { freePort, isolated, reapedUnder } from "./slice-builder.ts";
import { CONTRACT, type Hire, hireIn, opened, setupRefusedIn, type Spent, unsetKeys, WRITE_UP_MINUTES } from "./stage.ts";
import { CHECKING, SPEC } from "./spelled.ts";
import { quoted, type Sentence, sentences, SPEC_CAP } from "./ticket-shape.ts";

const OUTCOMES = { held: "Held", missed: "Did not hold", owner: "Put to the owner", self: "Held", fixed: "Fixed before it landed" } as const;
const ANSWERED = ["held", "missed", "owner", "self"] as const;
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
          outcome: { type: "string", enum: ANSWERED },
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

export interface Try {
  sentence: number;
  outcome: Outcome;
  tried: string;
}

export const REPLIES_CAP = 8 * 1024;
export const OUT_OF_TIME = "Your time to try is up. Try nothing more. Answer now: every sentence you did not finish is `missed`, its `tried` saying what you saw and what was left to try.\n";

const answered = (replies: string) =>
  replies === "" ? [] : ["## The owner's replies since the last done check", tailOf(replies, REPLIES_CAP), "Where the owner says a sentence held or did not, his word is its try."];

const RUNNING_HERE =
  "For this repo the running system is the landed code in this checkout, which no Actions run has used yet: run its stages against stand-ins, such as a throwaway clone and a fake `gh`, and read its earlier Actions runs and the issues and PRs they touched with `gh` for how it behaves live. What only a live run can show goes to the owner.";
const BROWSER =
  "Start the app only with `preview url [path] [--as role]`, which starts this checkout's dev server once, reuses it after and prints the page's signed-in URL; never start `pnpm dev`, `next dev` or any server yourself. Run `preview stop` once your last try is done. Settle what a sentence rests on by calling the app's server directly, its routes and actions, which answers in a fraction of a second, and open a page only for what the page itself must show. Drive one page at a time with `ui-check` (`ui-check open <url>`, `goto`, `click`, `eval`, `screenshot`, `--device`). To try sentences that do not depend on each other side by side, or a flow `ui-check` cannot script, open them as pages of one Playwright script that requires `$(npm root -g)/playwright-core` and launches `channel: \"chrome\"`. Install no browser or driver of your own. `tools <words>` finds any other tool here.";
const RUNNING_THERE = `Here the running system is this checkout of the repo, readied by its contract's setup, and its Actions runs and the issues and PRs they touched, read with \`gh\`.\n\n${BROWSER}`;
const SELF =
  " `self`, without trying it, for a sentence about the spec closing itself or the owner being told which sentence did not hold: this run is the one that closes the spec and files each miss, so the machine settles it from the other sentences.";


const numbered = (listed: Sentence[]) => listed.map(({ said }, at) => `${at + 1}. ${said}`).join("\n");

export function handedOn(title: string, body: string, { replies = "", foreign = false, unset = [] }: { replies?: string; foreign?: boolean; unset?: string[] } = {}): string {
  return [
    `Try each sentence under \`## The sentences to try\` on the running system, not on its tests, and say how each came out. Read and run what you need, and leave the repo and GitHub as they are. ${foreign ? RUNNING_THERE : RUNNING_HERE}`,
    ...(unset.length === 0 ? [] : [`The repo's contract names ${listedCapped(unset.map((key) => `\`${key}\``))}, which its secrets lack, so this run has none of them: a sentence resting on one is \`owner\`, its \`tried\` naming the key to set as a repo secret.`]),
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
const closedWith = (putToOwner: [number, string, Try][]) => `Closed with sentence ${listing(putToOwner, ", ")} put to the owner, said here and filed nowhere; the owner files a miss he sees live as a new ticket.`;

const SAID = (issue: string) => `done-check: #${issue}`;
const HIRE: Omit<Hire, "transcript"> = { name: "done checker", model: "opus", effort: "medium", answers: TRIES, writeUp: { minutes: WRITE_UP_MINUTES, told: OUT_OF_TIME } };

interface Read {
  asked: Asked;
  listed: Sentence[];
  replies: string;
}

const NOTHING_POSTED = (issue: string) => `Nothing was posted, so once its cause is fixed the done check is safe to run again on its own: \`bin/done-check ${issue}\` on a checkout of main, with \`${STUCK}\` off.`;

export const doneCheckCalledOwner = (issue: string, why: string, follows = NOTHING_POSTED(issue)) => calledOwner(issue, { who: "the done check", said: `${SAID(issue)} marked ${STUCK}` }, why, follows);

const unlisted = (asked: Asked): Sentence[] | string => {
  if (!asked.labels.has(SPEC)) return "is not a spec, so nothing was tried";
  const listed = sentences(asked.body);
  return listed.length === 0 ? "carries no sentence to try, so nothing was tried or closed" : listed;
};

function repliesOn(issue: string): string {
  const authored = authoredOn(issue, `#${issue} could not read its comments, so nothing was tried`, gh);
  const since = authored.map(({ body }) => body.startsWith(DONE_CHECK_HEADING)).lastIndexOf(true);
  return since === -1 ? "" : authored.slice(since + 1).flatMap(({ author, body }) => (author === OWNER ? [body] : [])).join("\n\n");
}

const setupFailed = (unready: string | undefined) => (unready === undefined ? undefined : `its tree's setup failed: ${quoted(unready)}`);

function read(issue: string): Read | number {
  const spec = opened({
    stage: "done-check",
    issue,
    state: CHECKING,
    hire: HIRE,
    ready: (asked) => {
      const listed = unlisted(asked);
      return Array.isArray(listed) ? { carrying: { listed, replies: repliesOn(issue) } } : endedRed(`${SAID(issue)} ${listed}`);
    },
  });
  return typeof spec === "object" ? { asked: spec.asked, ...spec.carried } : spec;
}

async function spentIsolated(tree: string, issue: string, input: string): Promise<Spent> {
  const isolation = await isolated(tree, [issue, "done-check"], await freePort());
  if (typeof isolation === "string") return { stdout: "", refusal: isolation };
  const unready = setupFailed(await setupRefusedIn(tree, onDisk(join(tree, CONTRACT)) ?? "", { ...isolation }));
  if (unready !== undefined) return { stdout: "", refusal: unready };
  const reaped = tree === process.cwd() ? [isolation.TMPDIR] : [tree, isolation.TMPDIR];
  return hireIn(tree, "done-check", issue, HIRE, { ...isolation })(input).finally(() => reapedUnder(reaped));
}

export const paired = (listed: Sentence[], tries: Try[]): [number, string, Try | undefined][] =>
  listed.map(({ said }, at) => [at + 1, said, tries.find(({ sentence }) => sentence === at + 1)]);

const handedFor = ({ asked, replies }: Read) => handedOn(asked.title, asked.body, { replies, foreign: FOREIGN, unset: unsetKeys() });

function triesIn(spent: Spent, listed: Sentence[]): Try[] | { refusal: string } {
  if (spent.refusal !== undefined) return { refusal: spent.refusal };
  const given = (spent.answer as { tries?: unknown } | undefined)?.tries;
  const found = paired(listed, Array.isArray(given) ? given.filter(isTry) : []);
  const untried = found.find(([, , one]) => one === undefined);
  return untried === undefined ? found.flatMap(([, , one]) => (one === undefined ? [] : [one])) : { refusal: `the done checker gave no try for sentence ${untried[0]}` };
}

function commented(issue: string, text: string): { url: string } | number {
  const comment = commentOnTicket(issue, text, gh);
  const [refusal] = comment.refusals;
  return refusal === undefined ? { url: comment.said } : doneCheckCalledOwner(issue, `its comment would not post: ${quoted(refusal)}`);
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

export function postedOn(issue: string, listed: Sentence[], tries: Try[], fixed: number[]): Checked | number {
  const found = settled(paired(listed, tries).map(([number, sentence, given]): [number, string, Try] => {
    const one = given ?? { sentence: number, outcome: "missed", tried: "the done check gave no try for it" };
    return [number, sentence, one.outcome === "missed" && fixed.includes(number) ? { ...one, outcome: "fixed" } : one];
  }));
  const missed = found.filter(([, , one]) => one.outcome === "missed");
  const putToOwner = found.filter(([, , one]) => one.outcome === "owner");
  const comment = commented(issue, posted(found, missed.length > 0 || putToOwner.length === 0 ? [] : [closedWith(putToOwner)]));
  if (typeof comment === "number") return comment;
  const bugs = missed.map(([number, sentence, one]) => ({ number, ...postedUnderOrigin({ kind: "bug", title: quoted(sentence), text: followUpBody([fromLine(fromHere(issue), "done-check"), "", `> ${one.tried}`], [sentence]) }, gh) }));
  const refused = bugs.find(({ refusals }) => refusals.length > 0);
  if (refused !== undefined) return doneCheckCalledOwner(issue, `sentence ${refused.number} would not file: ${quoted(refused.refusals[0] ?? "")}`, `Its comment is posted: file each miss as a bug, and close #${issue} by hand.`);
  const held =
    missed.length > 0
      ? `did not hold sentence ${listing(missed, ", ")}, filed as ${bugs.map(({ said }) => said.trim()).join(", ")},`
      : putToOwner.length === 0
        ? "held every sentence"
        : "held every sentence it could try, put the rest to the owner,";
  if (gh(["issue", "close", issue, "--reason", "completed"]).status !== 0) return doneCheckCalledOwner(issue, `it ${held} but would not close: ${comment.url}`, `Its comment is posted, so nothing is left to try: close #${issue} by hand.`);
  console.log(`${SAID(issue)} ${held} and is closed: ${comment.url}`);
  return { missed: missed.map(([number]) => number) };
}

export async function doneCheck(issue: string, app: AppKey | undefined): Promise<Checked | number> {
  const spec = read(issue);
  if (typeof spec !== "object") return spec;
  if (app !== undefined) freshAppToken(app, gh, `so the done check of #${issue} is not tried`);
  const tries = triesIn(await spentIsolated(process.cwd(), issue, handedFor(spec)), spec.listed);
  if (app !== undefined) freshAppToken(app, gh, `so the done check of #${issue} is not posted`);
  if (!Array.isArray(tries)) return doneCheckCalledOwner(issue, tries.refusal);
  return postedOn(issue, spec.listed, tries, []);
}

export async function triedIn(tree: string, issue: string): Promise<Try[] | { refusal: string }> {
  const asked = askedOn(issue, "so nothing was tried");
  const stood = stoodDown(asked);
  if (stood !== undefined) return { refusal: `#${issue} ${stood}, so nothing was tried` };
  const listed = unlisted(asked);
  if (!Array.isArray(listed)) return { refusal: `#${issue} ${listed}` };
  return triesIn(await spentIsolated(tree, issue, handedFor({ asked, listed, replies: repliesOn(issue) })), listed);
}

if (import.meta.main) {
  const [issue] = process.argv.slice(2);
  if (issue === undefined) throw new Error("no issue number in the arguments");
  const ended = await readOrStop("done-check", () => doneCheck(issue, takenAppKey()));
  process.exit(typeof ended === "number" ? ended : 0);
}
