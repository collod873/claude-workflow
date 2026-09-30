import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { FENCED_OPUS } from "./fence.ts";
import { askedIssue, commentOnTicket, gh, post } from "./post.ts";
import { LIST_CAP, NO_EM_DASH, TICKET_CAP } from "./reviewer.ts";
import { hired, machineLogs, type Spent } from "./stage.ts";
import { exitFor, stoppedAt, type Stop } from "./stops.ts";
import { DONE_SENTENCES, filedOutOfScope, filedPassages, type Passage, quoted, restored, sectionsDropped, SPEC_CAP, specRefusals, ticketRefusals } from "./ticket-shape.ts";

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
  },
  required: ["spec", "tickets"],
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
}

export function handedOn(title: string, body: string): string {
  const spec = capped(`# ${title}\n\n${body}`, SPEC_CAP);
  return [
    "Slice this filed spec into its first wave of tickets. Read the repo as you need; change nothing here. No one is watching and no one will answer a question: where the spec is silent, pick, and write your pick into the spec.",
    "## The spec",
    spec,
    "## Its Problem Statement, passage by passage",
    filedPassages(spec).map(({ text }, at) => `${at + 1}. ${text}`).join("\n\n") || "(none)",
    "## Your answer",
    "`spec`: the spec rewritten in full. Settle under `### Names the tickets share` in `## Implementation Decisions` each name two tickets both need, a label, a path, a command or a key, and write each pick you made where the spec was silent where it belongs. Keep `## Problem Statement` and `## Out of Scope` under their headings: code puts back the owner's bytes as filed.",
    `\`tickets\`: the first wave, each building at once beside the others and none waiting on another. \`title\`; \`passages\`, the numbers of the Problem Statement passages its \`## Why\` quotes, which code copies in; \`why\`, what this ticket is for in the spec, which follows the quote; \`done\`, ${DONE_SENTENCES}. Code adds the spec's Out of Scope to each. A ticket over the builder's brief cap of ${TICKET_CAP} bytes comes back to you to split.`,
    "",
  ].join("\n\n");
}

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
  return typeof given?.spec === "string" && Array.isArray(given.tickets);
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
  return [...rewrite, ...none, ...tickets];
}

function filedWave(issue: string, read: string, wave: Wave): Stop | undefined {
  const said = `slice: #${issue}`;
  const edited = gh(["issue", "edit", issue, "--body", wave.spec]);
  if (edited.status !== 0) return stoppedAt("unfiled", `${said} ended red, its rewrite would not post: ${quoted((edited.stderr || edited.stdout).trim())}`);
  const passages = filedPassages(read);
  const numbers: string[] = [];
  for (const piece of wave.tickets) {
    const filed = post({ kind: "ticket", title: piece.title, text: ticketBody(read, passages, piece) }, gh);
    const number = FILED.exec(filed.said)?.[1];
    const id = number === undefined ? undefined : gh(["api", `repos/{owner}/{repo}/issues/${number}`, "--jq", ".id"]);
    const linked = id?.status === 0 ? gh(["api", "--method", "POST", `repos/{owner}/{repo}/issues/${issue}/sub_issues`, "-F", `sub_issue_id=${id.stdout.trim()}`]) : undefined;
    if (linked?.status !== 0) {
      const why = filed.refusals[0] ?? `#${number} would not go under it`;
      return stoppedAt("unfiled", `${said} filed ${numbers.length} of ${wave.tickets.length} tickets, ${JSON.stringify(piece.title)} would not file: ${quoted(why)}`);
    }
    numbers.push(`#${number}`);
  }
  console.log(`${said} filed its first wave under it: ${numbers.join(", ")}`);
  return undefined;
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
