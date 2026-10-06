import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { capped, LIST_CAP, NO_EM_DASH, TICKET_CAP } from "./brief.ts";
import { FILED } from "./builder.ts";
import { FENCED_OPUS } from "./fence.ts";
import { commentOnTicket, commentsRead, gh, ghRead, mark, post, readOrStop, STUCK } from "./post.ts";
import { BUILDING, SLICING, SPEC } from "./spelled.ts";
import { opened, type Spent } from "./stage.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { missedIn, WAVE_CHECK_HEADING } from "./done-checker.ts";
import { DIFF_CAP, ended, FOUND_CAP, resumed, movesMarker, underSpec, waveDiffs, waveFound, waveHeading, waveNotes } from "./wave.ts";
import { DONE_SENTENCES, filedOutOfScope, filedPassages, filedRecord, type Passage, quoted, recordRefusals, type Recorded, sentences, SPEC_CAP, spliced, ticketRefusals } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  notSpec: "Slice refused: the issue is not labelled `spec`",
  unsliced: "Slice: the wave is still refused after two rounds back, so the spec is marked `stuck`",
  unfiled: "Slice: the spec's rewrite, a ticket of its wave or the wave's note will not post",
  unchecked: "Slice: nothing is left to slice, and the done check it hands the spec to ends red",
  unfixed: "Slice: the slicer gives no ticket for the spec's fix wave, so nothing is filed",
});
type Stop = ReturnType<typeof stoppedAt>;

const TOOLS = ["Read", "Grep", "Glob"];
const ROUNDS_BACK = 2;
export const COMMENTS_CAP = 16 * 1024;
const DONE_CHECK = join(import.meta.dirname, "..", "bin", "done-check");

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
    record: { type: "string", pattern: NO_EM_DASH },
    tickets: { type: "array", items: PIECE },
    did: { type: "string", pattern: NO_EM_DASH },
    next: { type: "string", pattern: NO_EM_DASH },
    moves: { type: "array", items: { type: "integer" } },
  },
  required: ["record", "tickets", "did", "next", "moves"],
  additionalProperties: false,
};

interface Piece {
  title: string;
  passages: number[];
  why: string;
  done: string[];
}

interface Wave {
  record: string;
  tickets: Piece[];
  did: string;
  next: string;
  moves: number[];
}

export interface Found {
  comments: string[];
  tickets: string;
  diffs: string;
  missed: number[];
  fix: boolean;
}

const FIRST = "Slice this filed spec into its first wave of tickets.";
const NEXT =
  "Slice this spec's next wave: the wave before it has closed. Read what it did below, the owner's comments and the last wave check, and slice the next wave against the spec and what that wave merged, split or noted.";
const WATCHED = "Read the repo as you need. No one is watching and no one will answer a question: where the spec is silent, pick, and write your pick into the spec's decisions record.";

const listed = (numbers: number[]) => numbers.join(", ");

const fixing = (missed: number[]) =>
  `Slice this spec's one fix wave: the done check found sentence ${listed(missed)} did not hold with every ticket closed. Read what the waves did below, and slice the fewest tickets that make ${missed.length === 1 ? "it" : "them"} hold; \`moves\` names exactly ${missed.length === 1 ? "that sentence" : "those sentences"}.`;

const owed = (missed: number[]) => `The last wave check missed sentence ${listed(missed)}: this wave carries at least one ticket, and its \`moves\` name each of them.`;

const FOLDED =
  "Read the diffs as what the wave built: cut each pick whose ticket merged to a shipped name, and fold the helpers, seams and modules the wave built that tickets share into the record. Where the wave left two copies of one helper or a shallow module, file a ticket to merge or deepen it, and hold the tickets that touch that module back a wave. Say in `did` what you folded in and why.";

function lead(found: Found | undefined): string {
  if (found === undefined) return FIRST;
  if (found.fix) return fixing(found.missed);
  return found.missed.length === 0 ? NEXT : `${NEXT} ${owed(found.missed)}`;
}

const SETTLED =
  "Under `### Picks`, each pick you made where the spec was silent, in full, and each name two tickets both need, a label, a command or a key, in the words of the repo's `CONTEXT.md`. Under `### Shipped names`, one line each: a name a merged ticket shipped and the `CONTEXT.md` term or ADR it lives under. Write no path, which code refuses, and no `## ` heading.";

const SLOT_FIRST = "Where pieces plug into one shared surface, slice the surface's slot a wave ahead of them, so no two tickets of a wave edit one file.";

function room(recorded: Recorded): string {
  const left = SPEC_CAP - Buffer.byteLength(spliced(recorded));
  const standing = left >= 0 ? `${left} under` : `${-left} over`;
  return `The owner's bytes come to ${Buffer.byteLength(recorded.owner)} and the record's to ${Buffer.byteLength(recorded.record)}, leaving ${standing} the spec cap of ${SPEC_CAP}: a record that puts the spec over the cap comes back to you, so make room by cutting the record before you add.`;
}

export function handedOn(title: string, body: string, found?: Found): string {
  const recorded = filedRecord(body);
  const spec = capped(`# ${title}\n\n${spliced(recorded)}`, SPEC_CAP);
  const read =
    found === undefined
      ? []
      : [
          "## Comments on the spec, the owner's and the machine's, newest first",
          capped([...found.comments].reverse().join("\n\n---\n\n"), COMMENTS_CAP) || "(none)",
          "## The tickets under it, newest first",
          capped(found.tickets, FOUND_CAP) || "(none)",
          "## The diff of each PR the wave merged, newest first",
          capped(found.diffs, DIFF_CAP) || "(none)",
          FOLDED,
        ];
  const last = found === undefined || found.fix || found.missed.length > 0 ? "" : " Give no ticket when nothing is left to slice: code then files nothing and the done check tries every sentence.";
  return [
    `${lead(found)} ${WATCHED}`,
    "## The spec",
    spec,
    "## Its Problem Statement, passage by passage",
    filedPassages(spec).map(({ text }, at) => `${at + 1}. ${text}`).join("\n\n") || "(none)",
    "## The sentences it will be tried on",
    sentences(spec).map(({ said }, at) => `${at + 1}. ${said}`).join("\n") || "(none)",
    ...read,
    "## Your answer",
    `\`record\`: the spec's decisions record in full, which code splices in as \`## Decisions record\` just before the sentences; every other byte of the spec stays as filed. ${room(recorded)} ${SETTLED}`,
    `\`tickets\`: the ${found === undefined ? "first" : found.fix ? "fix" : "next"} wave, the fewest tickets that each fit the builder's brief cap of ${TICKET_CAP} bytes, all building at once beside each other. First find which parts each piece touches before you group them: one ticket unless two pieces touch different parts and neither needs the other's code. ${SLOT_FIRST} \`title\`; \`passages\`, the numbers of the Problem Statement passages its \`## Why\` quotes, which code copies in; \`why\`, what this ticket is for in the spec, which follows the quote; \`done\`, ${DONE_SENTENCES}. Code adds the spec's Out of Scope to each. A ticket over the cap comes back to you to split.${last}`,
    NOTED,
    "",
  ].join("\n\n");
}

const NOTED =
  "Code posts one note on the spec for this wave, quoting the passages its tickets quote. `did`: what the wave before it did, or for the first wave what you settled in the spec, in plain words for the owner. `next`: what this wave builds and what comes after it, in plain words. `moves`: the numbers of the sentences this wave should move, which a wave check tries once it closes. Name in `moves` only a sentence this wave's own tickets, once merged, make visible on the running system without another wave: a sentence that waits on a later wave's code is only listed as not tried yet, and the next wave check tries it again, so naming it spends a check for nothing. Only a sentence that needs two PRs in the closer's queue at once may still be named.";

export const sentBack = (refusals: string[]): string =>
  ["Code refused your wave, so nothing is filed yet:", capped(refusals.map((refusal) => `- ${refusal}`).join("\n"), LIST_CAP), "Answer again in full: the `record` and every ticket of the wave.", ""].join("\n\n");

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
  return typeof given?.record === "string" && Array.isArray(given.tickets) && typeof given.did === "string" && typeof given.next === "string" && Array.isArray(given.moves);
}

function waveRefusals(read: string, wave: Wave, found: Found | undefined): string[] {
  const passages = filedPassages(read);
  const record = recordRefusals({ owner: filedRecord(read).owner, record: wave.record });
  const missed = found?.missed ?? [];
  const empty = wave.tickets.length > 0 ? [] : found === undefined ? ["the wave carries no ticket"] : missed.length > 0 ? [`the wave carries no ticket, and the last wave check missed sentence ${listed(missed)}`] : [];
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
  const tried = sentences(read).length;
  const moves = wave.moves.filter((sentence) => !(Number.isInteger(sentence) && sentence >= 1 && sentence <= tried)).map((sentence) => `the note moves sentence ${sentence}, and the spec lists ${tried}`);
  return [...record, ...empty, ...tickets, ...moves, ...owedMoves(wave.moves, found)];
}

function owedMoves(moves: number[], found: Found | undefined): string[] {
  if (found === undefined) return [];
  if (!found.fix) return found.missed.filter((sentence) => !moves.includes(sentence)).map((sentence) => `the note leaves out sentence ${sentence}, which the last wave check missed`);
  const given = [...new Set(moves)].sort((one, other) => one - other);
  return listed(given) === listed(found.missed) ? [] : [`the fix wave moves sentence ${listed(moves) || "none"}, and must move exactly sentence ${listed(found.missed)}`];
}

function missedSinceNote(comments: string[]): number[] {
  const note = comments.map((said) => waveNotes([said]).length > 0).lastIndexOf(true);
  const check = comments.map((said) => said.startsWith(WAVE_CHECK_HEADING)).lastIndexOf(true);
  return check > note ? [...missedIn(comments[check] ?? "")].sort((one, other) => one - other) : [];
}

function filedWave(issue: string, read: string, wave: Wave, number: number): Stop | undefined {
  const said = `slice: #${issue}`;
  const edited = gh(["issue", "edit", issue, "--body", spliced({ owner: filedRecord(read).owner, record: wave.record })]);
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
    const id = ghRead(["api", `repos/{owner}/{repo}/issues/${number}`, "--jq", ".id"], `#${issue} filed #${number}, but its id could not be read, so it is not under the spec`);
    const linked = gh(["api", "--method", "POST", `repos/{owner}/{repo}/issues/${issue}/sub_issues`, "-F", `sub_issue_id=${id}`]);
    if (linked.status !== 0) return partWave(issue, wave, [...numbers, `#${number}, not under this spec`], at + 1, `#${number} would not go under it`);
    numbers.push(`#${number}`);
  }
  const which = number === 1 ? "its first wave" : `wave ${number}`;
  const [unnoted] = commentOnTicket(issue, waveNote(number, passages, wave, numbers), gh).refusals;
  if (unnoted !== undefined) return stoppedAt("unfiled", `${said} filed ${which} under it, ${numbers.join(", ")}, but its note would not post: ${quoted(unnoted)}`);
  mark(issue, BUILDING);
  console.log(`${said} filed ${which} under it: ${numbers.join(", ")}`);
  return undefined;
}

function waveNote(number: number, passages: Passage[], wave: Wave, filed: string[]): string {
  const quoting = [...new Set(wave.tickets.flatMap((piece) => piece.passages))].sort((one, other) => one - other);
  return `${[waveHeading(number), quote(passages, quoting), wave.did.trim(), wave.next.trim(), `Filed: ${filed.join(", ")}.`, movesMarker(wave.moves)].join("\n\n")}\n`;
}

function partWave(issue: string, wave: Wave, filed: string[], next: number, since: string): Stop {
  const left = wave.tickets.slice(next).map(({ title }) => JSON.stringify(title));
  const comment = [`The slicer rewrote this spec and filed only part of its wave, since ${since}`, `Filed: ${filed.join(", ") || "none"}.`, `Not filed: ${left.join(", ") || "none"}.`];
  const [unposted] = commentOnTicket(issue, comment.join("\n\n"), gh).refusals;
  const stopped = unposted === undefined ? since : `${quoted(since)}; no comment says so, ${quoted(unposted)}`;
  return stoppedAt("unfiled", `slice: #${issue} filed ${filed.length} of ${wave.tickets.length} tickets, ${stopped}`);
}

function sliced(issue: string, fix?: number[]): Stop | undefined {
  const said = `slice: #${issue}`;
  const opening = opened({
    stage: "slice",
    issue,
    state: SLICING,
    tried: fix !== undefined,
    stoppedAt,
    hire: { name: "slicer", tools: TOOLS, reach: FENCED_OPUS, answers: ANSWERS },
    ready: (asked) => {
      if (!asked.labels.has(SPEC)) return stoppedAt("notSpec", `${said} is not a spec, so nothing sliced it`);
      const tickets = underSpec(issue, "so no model was spent");
      const [unclosed] = tickets.filter(({ state }) => state === "open");
      if (unclosed !== undefined) {
        console.log(`${said}'s wave is not over, #${unclosed.number} is still open, so nothing sliced it`);
        return undefined;
      }
      const first = tickets.length === 0 && fix === undefined;
      const comments = first ? [] : commentsRead(issue, `the comments on #${issue} could not be read, so no model was spent`, gh);
      const found: Found | undefined = first ? undefined : { comments, tickets: waveFound(tickets), diffs: waveDiffs(tickets), missed: fix ?? missedSinceNote(comments), fix: fix !== undefined };
      return { carrying: { comments, found } };
    },
  });
  if (typeof opening !== "object") return opening;
  const { asked, spend, carried: { comments, found } } = opening;
  let spent: Spent = spend(handedOn(asked.title, asked.body, found));
  for (let round = 0; ; round++) {
    if (spent.refusal !== undefined) return stoppedAt("modelRun", `${said} ended red, ${spent.refusal}`);
    if (!isWave(spent.answer)) return stoppedAt("modelRun", `${said} ended red, the slicer gave no wave`);
    if (found?.fix === true && spent.answer.tickets.length === 0) return stoppedAt("unfixed", `${said} ended red, the slicer gave no ticket for its fix wave, so nothing was filed`);
    if (found !== undefined && found.missed.length === 0 && spent.answer.tickets.length === 0) return handedOff(issue);
    const wave = spent.answer;
    const refusals = waveRefusals(asked.body, wave, found);
    if (refusals.length === 0) return filedWave(issue, asked.body, wave, waveNotes(comments).length + 1);
    if (round === ROUNDS_BACK) return calledOwner(issue, `its wave still refused after ${ROUNDS_BACK} rounds back: ${quoted(refusals[0] ?? "")}`);
    spent = spend(sentBack(refusals), spent.session);
  }
}

function handedOff(issue: string): Stop | undefined {
  console.log(`slice: #${issue} has nothing left to slice, so the done check tries its sentences`);
  const checked = spawnSync(DONE_CHECK, [issue], { stdio: "inherit" });
  return checked.status === 0 ? undefined : stoppedAt("unchecked", `slice: #${issue} has nothing left to slice, and bin/done-check ${issue} ended red`);
}

function calledOwner(issue: string, why: string): Stop {
  mark(issue, STUCK);
  commentOnTicket(issue, `The slicer filed nothing: ${why}`, gh);
  return stoppedAt("unsliced", `slice: #${issue} marked ${STUCK}, ${why}`);
}

if (import.meta.main) {
  const [first, second, numbers] = process.argv.slice(2);
  if (first === undefined) throw new Error("no issue number in the arguments");
  const fix = second === "--fix" ? (numbers ?? "").split(/[ ,]+/).filter((number) => number !== "").map(Number) : undefined;
  process.exit(first === "--ended" && second !== undefined ? ended(second) : first === "--resumed" && second !== undefined ? resumed(second) : exitFor(readOrStop("slice", () => sliced(first, fix))));
}
