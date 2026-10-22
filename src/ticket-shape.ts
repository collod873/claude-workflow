
const NAMED = {
  why: "Why",
  doneWhen: "Done when",
  problem: "Problem Statement",
  solution: "Solution",
  stories: "User Stories",
  decisions: "Implementation Decisions",
  testing: "Testing Decisions",
  outOfScope: "Out of Scope",
  furtherNotes: "Further Notes",
  sentences: "I'll know it works when I can",
  record: "Decisions record",
  reliesOn: "Decisions it relies on",
  waitsOn: "Waits on",
} as const;
const heading = (name: string): RegExp => new RegExp(`^##[ \\t]+${name.replace("'", "[’']")}[ \\t]*(?=\\r?$)`, "m");
const WHY = heading(NAMED.why);
const DONE_WHEN = heading(NAMED.doneWhen);
const PROBLEM_STATEMENT = heading(NAMED.problem);
const SOLUTION = heading(NAMED.solution);
const USER_STORIES = heading(NAMED.stories);
const IMPLEMENTATION_DECISIONS = heading(NAMED.decisions);
const TESTING_DECISIONS = heading(NAMED.testing);
const OUT_OF_SCOPE = heading(NAMED.outOfScope);
const FURTHER_NOTES = heading(NAMED.furtherNotes);
const SENTENCES = heading(NAMED.sentences);
const DECISIONS_RECORD = heading(NAMED.record);
const WAITS_ON = heading(NAMED.waitsOn);
const ISSUE_REFERENCE = /(?<![\w/-])#(\d+)\b/g;
const NAMES_SHARED = /^###[ \t]+Names the tickets share[ \t]*(?=\r?$)/m;
export const NEXT_HEADING = /^##[ \t]/m;
const NEXT_SUBHEADING = /^###?[ \t]/m;
const ITEM = /^[ \t]*-[ \t]*\[[ xX]\][ \t]*/;
const OWNER_WORDS = /"[^"\n]{4,}"|^>[ \t]*\S/m;
const NUMBERED_ITEM = /^[ \t]*\d+[.)][ \t]/m;
const QUOTE = 80;

export const DONE_SENTENCES = "what is true once it is done";
export const WHY_SHAPE = [
  `Every filing opens with ## ${NAMED.why}, quoting what set it: Collin's words, a short exchange between him and an agent, a problem an agent found with its evidence, or work a session left unfinished.`,
  "The session and its transcript are linked for you.",
].join(" ");
export const BUILD_SHAPE = [
  `a decision Collin has made. Adds ## ${NAMED.doneWhen}: what we decided to do, said as ${DONE_SENTENCES}.`,
  "A build starts the moment it is filed, so a question still open makes it an idea or a look-into.",
].join(" ");
export const BUG_SHAPE = `a fault still standing; its ## ${NAMED.why} quotes the evidence, such as a log line, a failing test or error text. Adds ## ${NAMED.doneWhen}: what working looks like. It builds the moment it is filed.`;
export const IDEA_SHAPE = "something Collin floated, kept for him to decide.";
export const LOOK_INTO_SHAPE = "a question Collin wants answered before deciding; a research agent answers it.";
export const OWNER_SHAPE = `a step only Collin can take before shipped work can run, such as a dashboard setting, a key or a sign-in. Its ## ${NAMED.why} says what to do, where, and what waits on it.`;
export const SPEC_SHAPE = [
  "he asked for a spec in his own words: the whole statement of a big job, sliced into tickets and never built itself.",
  `  ## ${NAMED.problem} quoting the owner, ## ${NAMED.solution}, ## ${NAMED.stories} numbered, ## ${NAMED.decisions} naming no file paths,`,
  `  ## ${NAMED.testing}, ## ${NAMED.outOfScope}, ## ${NAMED.furtherNotes}, and last ## ${NAMED.sentences}, as '- [ ]' items`,
].join("\n");

export function matchEnd(found: RegExpMatchArray): number {
  const [whole] = found;
  if (whole === undefined || found.index === undefined) throw new Error("no whole match or index in a regex match");
  return found.index + whole.length;
}

function section(body: string, heading: RegExp): string {
  const found = heading.exec(body);
  if (found === null) return "";
  const rest = body.slice(matchEnd(found));
  const next = NEXT_HEADING.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

function itemsUnder(body: string, heading: RegExp, item = ITEM): string[] {
  const items: string[] = [];
  for (const line of section(body, heading).split("\n")) {
    if (item.test(line)) items.push(line.replace(item, "").trim());
    else if (items.length > 0 && line.trim() !== "") items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

export const why = (body: string): string => section(body.replaceAll(/\r\n?/g, "\n"), WHY).trim();

export const waitsOn = (body: string): string[] => [...new Set(Array.from(section(body.replaceAll(/\r\n?/g, "\n"), WAITS_ON).matchAll(ISSUE_REFERENCE), ([, number]) => number ?? ""))];

export const doneWhen = (body: string): string => section(body.replaceAll(/\r\n?/g, "\n"), DONE_WHEN).trim();

export const outOfScope = (body: string): string => section(body.replaceAll(/\r\n?/g, "\n"), OUT_OF_SCOPE).trim();

const blankLinesTrimmed = (text: string): string => text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");

export const filedOutOfScope = (body: string): string => blankLinesTrimmed(section(body, OUT_OF_SCOPE));

export interface Passage {
  text: string;
  after: string;
}

export function filedPassages(body: string): Passage[] {
  const pieces = section(body, PROBLEM_STATEMENT).split(/(\r?\n(?:[ \t]*\r?\n)+)/);
  const passages: Passage[] = [];
  for (let at = 0; at < pieces.length; at += 2) {
    const text = pieces[at] ?? "";
    if (text.trim() !== "") passages.push({ text: blankLinesTrimmed(text), after: pieces[at + 1] ?? "" });
  }
  return passages;
}

export interface Recorded {
  owner: string;
  record: string;
}

function lifted(body: string, heading: RegExp, next: RegExp): { owner: string; whole: string; inner: string } | undefined {
  const found = heading.exec(body);
  if (found === null) return undefined;
  const start = matchEnd(found);
  const end = next.exec(body.slice(start));
  const stop = end === null ? body.length : start + end.index;
  return { owner: body.slice(0, found.index) + body.slice(stop), whole: body.slice(found.index, stop), inner: body.slice(start, stop) };
}

export function filedRecord(body: string): Recorded {
  const standing = lifted(body, DECISIONS_RECORD, NEXT_HEADING);
  if (standing !== undefined) return { owner: standing.owner, record: blankLinesTrimmed(standing.inner) };
  const named = lifted(body, NAMES_SHARED, NEXT_SUBHEADING);
  return named === undefined ? { owner: body, record: "" } : { owner: named.owner, record: blankLinesTrimmed(named.whole) };
}

export function spliced({ owner, record }: Recorded): string {
  const kept = record.trim();
  if (kept === "") return owner;
  const at = SENTENCES.exec(owner)?.index ?? owner.length;
  return `${owner.slice(0, at)}## ${NAMED.record}\n\n${kept}\n\n${owner.slice(at)}`;
}

export const PICKS = "### Picks";
export const SHIPPED_NAMES = "### Shipped names";
export const ENTRY_FORM = "`- **name**:`";
export const RELIES_ON = `## ${NAMED.reliesOn}`;
const ENTRY_NAME = /^- \*\*(.+?)\*\*:/;
const ENTRY_BULLET = /^-[ \t]/;
const SUBHEADING = /^###?[ \t]/;

export interface Entry {
  name: string | undefined;
  bullet: string;
  pick: boolean;
}

export function recordEntries(record: string): Entry[] {
  const entries: { lines: string[]; pick: boolean }[] = [];
  let under: boolean | undefined;
  let open = false;
  for (const line of record.split("\n")) {
    if (SUBHEADING.test(line)) {
      under = line.trimEnd() === PICKS ? true : line.trimEnd() === SHIPPED_NAMES ? false : undefined;
      open = false;
    } else if (ENTRY_BULLET.test(line)) {
      open = under !== undefined;
      if (under !== undefined) entries.push({ lines: [line], pick: under });
    } else if (open) entries[entries.length - 1]?.lines.push(line);
  }
  return entries.map(({ lines, pick }) => ({ name: ENTRY_NAME.exec(lines[0] ?? "")?.[1], bullet: blankLinesTrimmed(lines.join("\n")), pick }));
}

function entryRefusals(record: string): string[] {
  const entries = recordEntries(record);
  const unnamed = entries.filter(({ name }) => name === undefined).map(({ bullet }) => `the record carries a bullet with no ${ENTRY_FORM}, so no ticket can cite it: ${JSON.stringify(quoted(bullet.split("\n")[0] ?? ""))}`);
  const names = entries.flatMap(({ name }) => (name === undefined ? [] : [name]));
  const twice = [...new Set(names.filter((name, at) => names.indexOf(name) !== at))].map((name) => `the record names ${JSON.stringify(name)} on two bullets, so a ticket citing it is ambiguous`);
  return [...unnamed, ...twice];
}

export function recordRefusals(recorded: Recorded, cap: Cap = SPEC_CAPPED): string[] {
  const headed = NEXT_HEADING.test(recorded.record) ? ["the record carries a '## ' heading, which would end it: head its parts with '### '"] : [];
  const bytes = Buffer.byteLength(spliced(recorded));
  const over = bytes > cap.bytes ? [`the spec would be ${bytes} bytes, over the ${cap.named} of ${cap.bytes}: the record must lose at least ${bytes - cap.bytes} bytes`] : [];
  return [...headed, ...entryRefusals(recorded.record), ...over];
}

export const whyChanged = (read: string, written: string): string[] => (why(written) === why(read) ? [] : ["the rewrite changes '## Why', the owner's words, which stay byte-identical"]);

export function rewriteRefusals(read: string, written: string): string[] {
  const changed = whyChanged(read, written);
  return changed.length > 0 ? changed : ticketRefusals(written);
}

export function quoted(text: string): string {
  return text.length > QUOTE ? `${text.slice(0, QUOTE - 1)}…` : text;
}

export function noteRefusals(body: string): string[] {
  const text = body.replaceAll(/\r\n?/g, "\n");
  const refusals: string[] = [];
  if (!WHY.test(text)) refusals.push("the body carries no '## Why', so nothing says why this was worth keeping");
  else if (section(text, WHY).trim() === "") refusals.push("'## Why' says nothing, so nothing says why this was worth keeping");
  return refusals;
}

interface WhyAsked {
  missing: string;
  unquoted: string;
}

const OWNER_ASKED: WhyAsked = {
  missing: "the body carries no '## Why', so nothing says what set this",
  unquoted: '\'## Why\' quotes nothing that set this: it carries no "..." quote and no > quoted line',
};

const EVIDENCE_ASKED: WhyAsked = {
  missing: "the body carries no '## Why', so nothing shows the fault",
  unquoted: '\'## Why\' quotes no evidence: it carries no "..." quote and no > quoted line from a log, a test or a Signal',
};

export const ticketRefusals = (body: string): string[] => builtRefusals(body, OWNER_ASKED);

export const bugRefusals = (body: string): string[] => builtRefusals(body, EVIDENCE_ASKED);

function builtRefusals(body: string, why: WhyAsked): string[] {
  const text = body.replaceAll(/\r\n?/g, "\n");
  const refusals: string[] = [];
  if (!WHY.test(text)) refusals.push(why.missing);
  else if (!OWNER_WORDS.test(section(text, WHY))) refusals.push(why.unquoted);
  if (!DONE_WHEN.test(text)) refusals.push("the body carries no '## Done when', so nothing says what done looks like");
  else if (section(text, DONE_WHEN).trim() === "") refusals.push("'## Done when' says nothing, so nothing says what done looks like");
  return refusals;
}

export const SPEC_CAP = 64 * 1024;

export interface Cap {
  bytes: number;
  named: string;
}

export const SPEC_CAPPED: Cap = { bytes: SPEC_CAP, named: "spec cap" };

export interface Sentence {
  said: string;
}

export function sentences(body: string): Sentence[] {
  return itemsUnder(body.replaceAll(/\r\n?/g, "\n"), SENTENCES).map((said) => ({ said }));
}

export function specRefusals(body: string): string[] {
  const text = body.replaceAll(/\r\n?/g, "\n");
  const refusals: string[] = [];
  if (!PROBLEM_STATEMENT.test(text)) refusals.push("the body carries no '## Problem Statement', so nothing says what the owner asked for");
  else if (!OWNER_WORDS.test(section(text, PROBLEM_STATEMENT))) refusals.push('\'## Problem Statement\' quotes no owner words: it carries no "..." quote and no > quoted line');
  if (!SOLUTION.test(text)) refusals.push("the body carries no '## Solution'");
  else if (section(text, SOLUTION).trim() === "") refusals.push("'## Solution' says nothing");
  if (!USER_STORIES.test(text)) refusals.push("the body carries no '## User Stories'");
  else if (!NUMBERED_ITEM.test(section(text, USER_STORIES))) refusals.push("'## User Stories' carries no numbered item");
  if (!IMPLEMENTATION_DECISIONS.test(text)) refusals.push("the body carries no '## Implementation Decisions'");
  if (!TESTING_DECISIONS.test(text)) refusals.push("the body carries no '## Testing Decisions'");
  else if (section(text, TESTING_DECISIONS).trim() === "") refusals.push("'## Testing Decisions' says nothing");
  if (!OUT_OF_SCOPE.test(text)) refusals.push("the body carries no '## Out of Scope'");
  else if (section(text, OUT_OF_SCOPE).trim() === "") refusals.push("'## Out of Scope' says nothing");
  if (!FURTHER_NOTES.test(text)) refusals.push("the body carries no '## Further Notes'");
  if (!SENTENCES.test(text)) {
    refusals.push("the body carries no '## I'll know it works when I can'");
  } else {
    const found = SENTENCES.exec(text);
    const after = found === null ? "" : text.slice(matchEnd(found));
    if (NEXT_HEADING.test(after)) refusals.push("a heading follows '## I'll know it works when I can', which must be last");
    if (itemsUnder(text, SENTENCES).length === 0) refusals.push("'## I'll know it works when I can' carries no '- [ ]' item, so the done check has nothing to try");
  }
  const bytes = Buffer.byteLength(text);
  if (bytes > SPEC_CAP) refusals.push(`the body is ${bytes} bytes, over the spec cap of ${SPEC_CAP}: cut at least ${bytes - SPEC_CAP} bytes`);
  return refusals;
}
