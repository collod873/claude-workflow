import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { FENCED_OPUS } from "./fence.ts";
import { askedIssue, commentOnTicket, gh, post } from "./post.ts";
import { LIST_CAP, NO_EM_DASH, TICKET_CAP } from "./reviewer.ts";
import { hired, machineLogs, type Spent } from "./stage.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { DONE_SENTENCES, filedOutOfScope, filedPassages, type Passage, quoted, restored, sectionsDropped, sentences, SPEC_CAP, specRefusals, ticketRefusals } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  notSpec: "Slice refused: the issue is not labelled `spec`",
  unsliced: "Slice: the wave is still refused after two rounds back, so the spec is marked `needs-human`",
  unfiled: "Slice: the spec's rewrite, a ticket of its wave or the wave's note will not post",
});
type Stop = ReturnType<typeof stoppedAt>;

const SPEC_LABEL = "spec";
const NEEDS_HUMAN = "needs-human";
const TOOLS = ["Read", "Grep", "Glob"];
const ROUNDS_BACK = 2;
const FILED = /\/issues\/(\d+)\s*$/;

const PIECE = {
  type: "object",
  properties: {
    title: { type: "string", pattern: NO_EM_DASH },
    passages: { type: "array", items: { type: "integer" } },
    why: { type: "string", pattern: NO_EM_DASH },
    done: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
  },
  required: ["title", "passages", "why", "done"],
  additionalProperties: false,
};

const ANSWERS = {
  type: "object",
  properties: {
    spec: { type: "string", pattern: NO_EM_DASH },
    tickets: { type: "array", items: PIECE },
    did: { type: "string", pattern: NO_EM_DASH },
    next: { type: "string", pattern: NO_EM_DASH },
    moves: { type: "array", items: { type: "integer" } },
  },
  required: ["spec", "tickets", "did", "next", "moves"],
  additionalProperties: false,
};

interface Piece {
  title: string;
  passages: number[];
  why: string;
  done: string[];
}

interface Wave {
  spec: string;
  tickets: Piece[];
  did: string;
  next: string;
  moves: number[];
}

export function handedOn(title: string, body: string): string {
  const spec = capped(`# ${title}\n\n${body}`, SPEC_CAP);
  return [
    "Slice this filed spec into its first wave of tickets. Read the repo as you need. No one is watching and no one will answer a question: where the spec is silent, pick, and write your pick into the spec.",
    "## The spec",
    spec,
    "## Its Problem Statement, passage by passage",
    filedPassages(spec).map(({ text }, at) => `${at + 1}. ${text}`).join("\n\n") || "(none)",
    "## The sentences it will be tried on",
    sentences(spec).map(({ said }, at) => `${at + 1}. ${said}`).join("\n") || "(none)",
    "## Your answer",
    "`spec`: the spec rewritten in full. Settle under `### Names the tickets share` in `## Implementation Decisions` each name two tickets both need, a label, a command or a key, in the words of the repo's `CONTEXT.md`, and no path, which code refuses there. Write each pick you made where the spec was silent where it belongs. `## Problem Statement` and `## Out of Scope` stay byte for byte: keep both under their headings, and code puts back the owner's bytes as filed.",
    `\`tickets\`: the first wave, the fewest tickets that each fit the builder's brief cap of ${TICKET_CAP} bytes, all building at once beside each other. First find which parts each piece touches before you group them: one ticket unless two pieces touch different parts and neither needs the other's code. \`title\`; \`passages\`, the numbers of the Problem Statement passages its \`## Why\` quotes, which code copies in; \`why\`, what this ticket is for in the spec, which follows the quote; \`done\`, ${DONE_SENTENCES}. Code adds the spec's Out of Scope to each. A ticket over the cap comes back to you to split.`,
    NOTED,
    "",
  ].join("\n\n");
}

const NOTED =
  "Code posts one note on the spec for this wave, quoting the passages its tickets quote. `did`: what the wave before it did, or for the first wave what you settled in the spec, in plain words for the owner. `next`: what this wave builds and what comes after it, in plain words. `moves`: the numbers of the sentences this wave should move, which a wave check tries once it closes.";

export const sentBack = (refusals: string[]): string =>
  ["Code refused your wave, so nothing is filed yet:", capped(refusals.map((refusal) => `- ${refusal}`).join("\n"), LIST_CAP), "Answer again in full: the rewritten `spec` and every ticket of the wave.", ""].join("\n\n");

const PASSAGE_BREAK = "\n\n";

function quote(passages: Passage[], picked: number[]): string {
  const quoted = picked.map((at) => passages[at - 1] ?? { text: "", after: "" });
  return quoted.map(({ text, after }, at) => (at === quoted.length - 1 ? text : text + (after || PASSAGE_BREAK))).join("");
}

function ticketBody(spec: string, passages: Passage[], piece: Piece): string {
  return [
    "## Why",
    quote(passages, piece.passages),
    piece.why.trim(),
    "## Done when",
    piece.done.map((sentence) => `- ${sentence.trim()}`).join("\n"),
    "## Out of Scope",
    filedOutOfScope(spec),
    "",
  ].join("\n\n");
}

function isWave(answer: unknown): answer is Wave {
  const given = answer as Partial<Wave> | undefined;
  return typeof given?.spec === "string" && Array.isArray(given.tickets) && typeof given.did === "string" && typeof given.next === "string" && Array.isArray(given.moves);
}

function waveRefusals(read: string, wave: Wave): string[] {
  const passages = filedPassages(read);
  const changed = sectionsDropped(read, wave.spec);
  const rewrite = changed.length > 0 ? changed : specRefusals(wave.spec).map((refusal) => `the rewrite: ${refusal}`);
  const none = wave.tickets.length === 0 ? ["the wave carries no ticket"] : [];
  const tickets = wave.tickets.flatMap((piece, at) => {
    const named = `ticket ${at + 1}, ${JSON.stringify(piece.title)},`;
    const unheld = piece.passages.filter((passage) => !(Number.isInteger(passage) && passage >= 1 && passage <= passages.length));
    const unquoted = piece.passages.length === 0 ? [`${named} quotes no passage`] : unheld.map((passage) => `${named} quotes passage ${passage}, and the Problem Statement has ${passages.length}`);
    if (unquoted.length > 0) return unquoted;
    const body = ticketBody(read, passages, piece);
    const bytes = Buffer.byteLength(body);
    const over = bytes > TICKET_CAP ? [`${named} would be ${bytes} bytes, over the builder's brief cap of ${TICKET_CAP} bytes: split it`] : [];
    return [...over, ...ticketRefusals(body).map((refusal) => `${named} ${refusal}`)];
  });
  const listed = sentences(read).length;
  const moves = wave.moves.filter((sentence) => !(Number.isInteger(sentence) && sentence >= 1 && sentence <= listed)).map((sentence) => `the note moves sentence ${sentence}, and the spec lists ${listed}`);
  return [...rewrite, ...none, ...tickets, ...moves];
}

function filedWave(issue: string, read: string, wave: Wave): Stop | undefined {
  const said = `slice: #${issue}`;
  const edited = gh(["issue", "edit", issue, "--body", wave.spec]);
  if (edited.status !== 0) return stoppedAt("unfiled", `${said} ended red, its rewrite would not post: ${quoted((edited.stderr || edited.stdout).trim())}`);
  const passages = filedPassages(read);
  const numbers: string[] = [];
  for (const [at, piece] of wave.tickets.entries()) {
    const title = JSON.stringify(piece.title);
    const filed = post({ kind: "ticket", title: piece.title, text: ticketBody(read, passages, piece) }, gh);
    const [refusal] = filed.refusals;
    if (refusal !== undefined) return partWave(issue, wave, numbers, at, `${title} would not file: ${quoted(refusal)}`);
    const number = FILED.exec(filed.said)?.[1];
    if (number === undefined) return partWave(issue, wave, [...numbers, `${title}, its number unknown and not under this spec`], at + 1, `${title} filed, but its number could not be read from ${JSON.stringify(quoted(filed.said))}`);
    const id = gh(["api", `repos/{owner}/{repo}/issues/${number}`, "--jq", ".id"]);
    const linked = id.status === 0 ? gh(["api", "--method", "POST", `repos/{owner}/{repo}/issues/${issue}/sub_issues`, "-F", `sub_issue_id=${id.stdout.trim()}`]) : id;
    if (linked.status !== 0) return partWave(issue, wave, [...numbers, `#${number}, not under this spec`], at + 1, `#${number} would not go under it`);
    numbers.push(`#${number}`);
  }
  const [unnoted] = commentOnTicket(issue, waveNote(1, passages, wave, numbers), gh).refusals;
  if (unnoted !== undefined) return stoppedAt("unfiled", `${said} filed its first wave under it, ${numbers.join(", ")}, but its note would not post: ${quoted(unnoted)}`);
  console.log(`${said} filed its first wave under it: ${numbers.join(", ")}`);
  return undefined;
}

function waveNote(number: number, passages: Passage[], wave: Wave, filed: string[]): string {
  const quoting = [...new Set(wave.tickets.flatMap((piece) => piece.passages))].sort((one, other) => one - other);
  return `${[`## Wave ${number}`, quote(passages, quoting), wave.did.trim(), wave.next.trim(), `Filed: ${filed.join(", ")}.`, `<!-- moves: ${wave.moves.join(", ")} -->`].join("\n\n")}\n`;
}

function partWave(issue: string, wave: Wave, filed: string[], next: number, since: string): Stop {
  const left = wave.tickets.slice(next).map(({ title }) => JSON.stringify(title));
  const comment = [`The slicer rewrote this spec and filed only part of its wave, since ${since}`, `Filed: ${filed.join(", ") || "none"}.`, `Not filed: ${left.join(", ") || "none"}.`];
  const [unposted] = commentOnTicket(issue, comment.join("\n\n"), gh).refusals;
  const stopped = unposted === undefined ? since : `${quoted(since)}; no comment says so, ${quoted(unposted)}`;
  return stoppedAt("unfiled", `slice: #${issue} filed ${filed.length} of ${wave.tickets.length} tickets, ${stopped}`);
}

function sliced(issue: string): Stop | undefined {
  const said = `slice: #${issue}`;
  const read = gh(["issue", "view", issue, "--json", "title,body,labels"]);
  const asked = read.status === 0 ? askedIssue(read.stdout) : undefined;
  if (asked === undefined) return stoppedAt("unread", `${said} could not be read, so no model was spent`);
  if (!asked.labels.some(({ name }) => name === SPEC_LABEL)) return stoppedAt("notSpec", `${said} is not a spec, so nothing sliced it`);
  const logs = machineLogs(process.cwd());
  mkdirSync(logs, { recursive: true });
  const spend = hired({ name: "slicer", transcript: join(logs, `slice-${issue}.jsonl`), tools: TOOLS, reach: FENCED_OPUS, answers: ANSWERS });
  if (typeof spend === "string") return stoppedAt("modelRun", `${said} ended red, the owner's hooks could not be read from ${spend}`);
  let spent: Spent = spend(handedOn(asked.title, asked.body));
  for (let round = 0; ; round++) {
    if (spent.refusal !== undefined) return stoppedAt("modelRun", `${said} ended red, ${spent.refusal}`);
    if (!isWave(spent.answer)) return stoppedAt("modelRun", `${said} ended red, the slicer gave no wave`);
    const wave = { ...spent.answer, spec: restored(asked.body, spent.answer.spec) };
    const refusals = waveRefusals(asked.body, wave);
    if (refusals.length === 0) return filedWave(issue, asked.body, wave);
    if (round === ROUNDS_BACK) return calledOwner(issue, `its wave still refused after ${ROUNDS_BACK} rounds back: ${quoted(refusals[0] ?? "")}`);
    spent = spend(sentBack(refusals), spent.session);
  }
}

function calledOwner(issue: string, why: string): Stop {
  gh(["issue", "edit", issue, "--add-label", NEEDS_HUMAN]);
  commentOnTicket(issue, `The slicer filed nothing: ${why}`, gh);
  return stoppedAt("unsliced", `slice: #${issue} marked ${NEEDS_HUMAN}, ${why}`);
}

if (import.meta.main) {
  const issue = process.argv[2];
  if (issue === undefined) throw new Error("no issue number in the arguments");
  process.exit(exitFor(sliced(issue)));
}
