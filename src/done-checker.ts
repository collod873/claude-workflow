import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { UNFENCED } from "./fence.ts";
import { askedIssue, authoredOn, commentOnTicket, gh, mark, NEEDS_HUMAN, OWNER, type Asked } from "./post.ts";
import { NO_EM_DASH } from "./reviewer.ts";
import { hired, machineLogs } from "./stage.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { SPEC_LABEL } from "./wave.ts";
import { quoted, type Sentence, sentences, SPEC_CAP } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  notSpec: "Refused: the issue is not labelled `spec`, or the done check finds no sentence to try",
  calledOwner: "Done check: a sentence missed twice, so the spec is marked `needs-human`",
  unfixed: "Done check: `bin/slice --fix` files no fix wave for the sentences that missed",
});
type Stop = ReturnType<typeof stoppedAt>;

const CHECK_MINUTES = 10;
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

const numbered = (ran: number[]) => (ran.length === 1 ? `Sentence ${ran.join("")} carries a check command the machine ran itself; give no try for it.` : `Sentences ${ran.join(", ")} carry a check command the machine ran itself; give no try for them.`);

const waveOnly = (wave: number[]) =>
  `This is a wave check: try only sentences ${wave.join(", ")}, the ones the wave just closed should have moved, and give no try for any other. Answer \`owner\` for one only the owner can try, without trying it; it waits for the end.`;

export const REPLIES_CAP = 8 * 1024;

const answered = (replies: string) =>
  replies === "" ? [] : ["## The owner's replies since the last done check", capped(replies, REPLIES_CAP), "Where the owner says a sentence held or did not, his word is its try."];

export function handedOn(title: string, body: string, { ran = [], wave, replies = "" }: { ran?: number[]; wave?: number[]; replies?: string } = {}): string {
  return [
    "Try each sentence under `## I'll know it works when I can` in this spec on the running system, not on its tests, and say how each came out. For this repo the running system is its own Actions runs and the issues and PRs they touched, read with `gh`. Read and run what you need, and leave the repo and GitHub as they are.",
    ...(wave === undefined ? [] : [waveOnly(wave)]),
    ...(ran.length === 0 ? [] : [numbered(ran)]),
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    ...answered(replies),
    "## Your answer",
    "`tries`: one item per sentence, `sentence` its number counting from 1 in the order the spec lists them. `outcome`: `held` when you saw it hold, `missed` when you saw it fail, `owner` when only the owner can try it, needing the owner's phone, eyes or a real customer. `self`, without trying it, for a sentence about the spec closing itself or the owner being told which sentence did not hold: this run is the one that closes the spec or names the miss, so the machine settles it from the other sentences. `tried`: what you did to try it and what you saw, or for `owner`, what the owner should do to try it.",
    "",
  ].join("\n\n");
}

function ranItself(check: string, sentence: number): Try {
  const { status } = spawnSync("bash", ["-c", check], { stdio: "ignore", timeout: CHECK_MINUTES * 60_000 });
  const exited = status === null ? `ran past its ${CHECK_MINUTES} minute cap` : `exited ${status}`;
  return { sentence, outcome: status === 0 ? "held" : "missed", tried: `Ran \`${check}\`, which ${exited}.` };
}

const isTry = (given: unknown): given is Try => {
  const one = given as Partial<Try> | undefined;
  return typeof one?.sentence === "number" && typeof one.tried === "string" && typeof one.outcome === "string" && one.outcome in OUTCOMES;
};

const DONE_CHECK_HEADING = "## Done check";
const FIX_WAVE = "<!-- fix-wave -->";

const posted = (tried: [number, string, Try][], after: string[] = []) =>
  [DONE_CHECK_HEADING, "", ...tried.map(([number, sentence, one]) => `${number}. **${OUTCOMES[one.outcome]}**: ${sentence}\n   ${one.tried}`), ...after.flatMap((line) => ["", line]), ""].join("\n");

const calledOwner = (missed: [number, string, Try][], when: string) =>
  missed.map(([number, sentence, one]) => `Sentence ${number} missed ${when}, so the spec is marked \`${NEEDS_HUMAN}\`: ${sentence}. Why: ${one.tried}`);

const listing = (missed: [number, string, Try][], between: string) => missed.map(([number]) => number).join(between);

export const WAVE_CHECK_HEADING = "## Wave check";
const WAVE_OUTCOMES: Record<Outcome, string> = { ...OUTCOMES, owner: "Waits for the end", self: "Waits for the end" };
const waitsForTheEnd = (outcome: Outcome) => outcome === "owner" || outcome === "self";
const waveLine = (number: number | string, outcome: string) => `- Sentence ${number}, **${outcome}**`;
const WAVE_MISSED = new RegExp(`^${waveLine("(\\d+)", OUTCOMES.missed).replaceAll("*", "\\*")}`, "gm");
export const missedIn = (waveCheck: string) => new Set([...waveCheck.matchAll(WAVE_MISSED)].map(([, number]) => Number(number)));

const wavePosted = (tried: [number, string, Try][], repeated: [number, string, Try][]) =>
  [
    WAVE_CHECK_HEADING,
    "",
    ...tried.map(([number, sentence, one]) => `${waveLine(number, WAVE_OUTCOMES[one.outcome])}: ${sentence}${waitsForTheEnd(one.outcome) ? "" : `\n  ${one.tried}`}`),
    ...calledOwner(repeated, "at this wave check and the last one").flatMap((line) => ["", line]),
    "",
  ].join("\n");

function triedByModel({ issue, asked, replies: owners }: Read, ran: number[], wave?: number[]): Try[] | string {
  const logs = machineLogs(process.cwd());
  mkdirSync(logs, { recursive: true });
  const spend = hired({ name: "done checker", transcript: join(logs, `done-check-${issue}.jsonl`), reach: UNFENCED, answers: TRIES });
  if (typeof spend === "string") return `the owner's hooks could not be read from ${spend}`;
  const replies = wave === undefined ? owners : "";
  const spent = spend(handedOn(asked.title, asked.body, { ran, wave, replies }));
  if (spent.refusal !== undefined) return spent.refusal;
  const given = (spent.answer as { tries?: unknown } | undefined)?.tries;
  return Array.isArray(given) ? given.filter(isTry).filter(({ sentence }) => !ran.includes(sentence)) : [];
}

interface Read {
  issue: string;
  said: string;
  asked: Asked;
  comments: string[];
  replies: string;
  listed: Sentence[];
}

function read(issue: string): Read | Stop {
  const said = `done-check: #${issue}`;
  const view = gh(["issue", "view", issue, "--json", "title,body,labels"]);
  const asked = view.status === 0 ? askedIssue(view.stdout) : undefined;
  if (asked === undefined) return stoppedAt("unread", `${said} could not be read, so nothing was tried`);
  if (!asked.labels.some(({ name }) => name === SPEC_LABEL)) return stoppedAt("notSpec", `${said} is not a spec, so nothing was tried`);
  const listed = sentences(asked.body);
  if (listed.length === 0) return stoppedAt("notSpec", `${said} carries no sentence to try, so nothing was tried or closed`);
  const authored = authoredOn(issue, gh);
  if (authored === undefined) return stoppedAt("unread", `${said} could not read its comments, so nothing was tried`);
  if (!asked.labels.some(({ name }) => name === NEEDS_HUMAN)) mark(issue, "checking");
  const comments = authored.map(({ body }) => body);
  const since = comments.map((comment) => comment.startsWith(DONE_CHECK_HEADING)).lastIndexOf(true);
  const replies = since === -1 ? "" : authored.slice(since + 1).flatMap(({ author, body }) => (author === OWNER ? [body] : [])).join("\n\n");
  return { issue, said, asked, comments, replies, listed };
}

function tried(spec: Read, numbers: number[], wave?: number[]): [number, string, Try][] | Stop {
  const { said, listed } = spec;
  const ran = numbers.flatMap((number) => {
    const check = listed[number - 1]?.check;
    return check === undefined ? [] : [ranItself(check, number)];
  });
  const given = ran.length === numbers.length ? [] : triedByModel(spec, ran.map(({ sentence }) => sentence), wave);
  if (typeof given === "string") return stoppedAt("modelRun", `${said} ended red, ${given}`);
  const tries = [...ran, ...given];
  const found: [number, string, Try][] = [];
  for (const number of numbers) {
    const one = tries.find(({ sentence }) => sentence === number);
    if (one === undefined) return stoppedAt("modelRun", `${said} ended red, the done checker gave no try for sentence ${number}`);
    found.push([number, listed[number - 1]?.said ?? "", one]);
  }
  return found;
}

function commented({ issue, said }: Read, text: string): { url: string } | Stop {
  const comment = commentOnTicket(issue, text, gh);
  const [refusal] = comment.refusals;
  return refusal === undefined ? { url: comment.said } : stoppedAt("unrecorded", `${said} ended red, its comment would not post: ${quoted(refusal)}`);
}

function waveCheck(issue: string, wave: number[]): Stop | undefined {
  const spec = read(issue);
  if (typeof spec === "string") return spec;
  const beyond = wave.find((number) => number < 1 || number > spec.listed.length);
  if (beyond !== undefined) return stoppedAt("notSpec", `${spec.said} carries no sentence ${beyond}, so nothing was tried`);
  const found = tried(spec, wave, wave);
  if (!Array.isArray(found)) return found;
  const missedBefore = missedIn(spec.comments.filter((comment) => comment.startsWith(WAVE_CHECK_HEADING)).at(-1) ?? "");
  const missed = found.filter(([, , one]) => one.outcome === "missed");
  const repeated = missed.filter(([number]) => missedBefore.has(number));
  const comment = commented(spec, wavePosted(found, repeated));
  if (typeof comment === "string") return comment;
  const posted = comment.url;
  if (repeated.length > 0) {
    gh(["issue", "edit", issue, "--add-label", NEEDS_HUMAN]);
    return stoppedAt("calledOwner", `${spec.said} marked ${NEEDS_HUMAN}, sentence ${listing(repeated, ", ")} missed at two wave checks in a row: ${posted}`);
  }
  const outcome = missed.length === 0 ? "held every sentence it tried" : `missed sentence ${listing(missed, ", ")}`;
  console.log(`${spec.said} wave check ${outcome}, and closes nothing: ${posted}`);
  return undefined;
}

function fixWave(spec: Read, found: [number, string, Try][], missed: [number, string, Try][]): Stop | undefined {
  const { issue, said, comments } = spec;
  const lastWave = comments.map((comment) => comment.startsWith(WAVE_CHECK_HEADING)).lastIndexOf(true);
  const lastDone = comments.map((comment) => comment.startsWith(DONE_CHECK_HEADING)).lastIndexOf(true);
  const missedAtWave = lastWave > lastDone ? missedIn(comments[lastWave] ?? "") : new Set<number>();
  const repeated = missed.filter(([number]) => missedAtWave.has(number));
  if (repeated.length > 0) {
    const comment = commented(spec, posted(found, calledOwner(repeated, "at the last wave check and again at the end")));
    if (typeof comment === "string") return comment;
    gh(["issue", "edit", issue, "--add-label", NEEDS_HUMAN]);
    return stoppedAt("calledOwner", `${said} marked ${NEEDS_HUMAN}, sentence ${listing(repeated, ", ")} missed at the last wave check and again at the end: ${comment.url}`);
  }
  if (comments.some((comment) => comment.startsWith(DONE_CHECK_HEADING) && comment.includes(FIX_WAVE))) {
    const comment = commented(spec, posted(found, calledOwner(missed, "again after the fix wave")));
    if (typeof comment === "string") return comment;
    gh(["issue", "edit", issue, "--add-label", NEEDS_HUMAN]);
    return stoppedAt("calledOwner", `${said} marked ${NEEDS_HUMAN}, sentence ${listing(missed, ", ")} missed again after the fix wave: ${comment.url}`);
  }
  const fixed = spawnSync(join(process.cwd(), "bin", "slice"), [issue, "--fix", listing(missed, ",")], { encoding: "utf8" });
  const comment = commented(spec, posted(found, fixed.status === 0 ? [FIX_WAVE] : []));
  if (typeof comment === "string") return comment;
  const [why = ""] = `${fixed.stderr}${fixed.stdout}`.trim().split("\n");
  if (fixed.status !== 0) return stoppedAt("unfixed", `${said} did not hold sentence ${listing(missed, ", ")}, and bin/slice --fix filed no fix wave: ${JSON.stringify(quoted(why))}: ${comment.url}`);
  console.log(`${said} did not hold sentence ${listing(missed, ", ")}, so bin/slice --fix filed its one fix wave: ${comment.url}`);
  return undefined;
}

const SELF_SETTLED = {
  missed: "This run names each other sentence that did not hold, and why.",
  owner: "This run leaves the spec open while another sentence waits on the owner.",
  held: "This run closed the spec, since every other sentence held.",
};

const settled = (found: [number, string, Try][]): [number, string, Try][] => {
  const others = found.map(([, , one]) => one.outcome);
  const tried = SELF_SETTLED[others.includes("missed") ? "missed" : others.includes("owner") ? "owner" : "held"];
  return found.map(([number, sentence, one]) => [number, sentence, one.outcome === "self" ? { ...one, tried } : one]);
};

function doneCheck(issue: string): Stop | undefined {
  const spec = read(issue);
  if (typeof spec === "string") return spec;
  const tries = tried(
    spec,
    spec.listed.map((_, at) => at + 1),
  );
  if (!Array.isArray(tries)) return tries;
  const found = settled(tries);
  const missed = found.filter(([, , one]) => one.outcome === "missed");
  if (missed.length > 0) return fixWave(spec, found, missed);
  const comment = commented(spec, posted(found));
  if (typeof comment === "string") return comment;
  const { said } = spec;
  if (found.some(([, , one]) => one.outcome === "owner")) {
    mark(issue, "asked");
    console.log(`${said} did not hold every sentence, so it stays open: ${comment.url}`);
    return undefined;
  }
  if (gh(["issue", "close", issue, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `${said} held every sentence but would not close: ${comment.url}`);
  console.log(`${said} held every sentence and is closed: ${comment.url}`);
  return undefined;
}

if (import.meta.main) {
  const [issue, flag, numbers] = process.argv.slice(2);
  if (issue === undefined) throw new Error("no issue number in the arguments");
  const wave = flag === "--wave" ? (numbers ?? "").split(/[ ,]+/).filter((number) => number !== "").map(Number) : undefined;
  process.exit(exitFor(wave === undefined ? doneCheck(issue) : waveCheck(issue, wave)));
}
