import { emDashLines } from "./em-dash.ts";

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
export const NEXT_HEADING = /^##[ \t]/m;
const ITEM = /^[ \t]*-[ \t]*\[[ xX]\][ \t]*/;
const BULLET = /^[ \t]*-(?:[ \t]*\[[ xX]\])?[ \t]+/;
const MARKER = /(?:–|(?<=[ \t])-{1,2}(?=[ \t]))[ \t]*check:[ \t]*`([^`\n]+)`[ \t]*$/;
const ATTEMPT = /check:/gi;
const OWNER_WORDS = /"[^"\n]{4,}"|^>[ \t]*\S/m;
const FILE_PATH = /[\w.-]+\/[\w./-]+\.[A-Za-z0-9]+/g;
const NUMBERED_ITEM = /^[ \t]*\d+[.)][ \t]/m;
const FEWEST = 1;
const MOST = 3;
const QUOTE = 80;

export const DONE_SENTENCES = `${FEWEST} to ${MOST} sentences saying what done looks like`;
export const TICKET_SHAPE = `## ${NAMED.why}, quoting the owner in "..." or a > line; ## ${NAMED.doneWhen}, ${DONE_SENTENCES}, each on a '- ' line`;
export const NOTE_SHAPE = `## ${NAMED.why}, saying why it is worth keeping`;
export const SPEC_SHAPE = [
  `## ${NAMED.problem} quoting the owner, ## ${NAMED.solution}, ## ${NAMED.stories} numbered, ## ${NAMED.decisions} naming no file paths,`,
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

function restoredSection(read: string, written: string, heading: RegExp): string {
  const found = heading.exec(written);
  if (found === null) return written;
  const start = matchEnd(found);
  const next = NEXT_HEADING.exec(written.slice(start));
  return written.slice(0, start) + section(read, heading) + (next === null ? "" : written.slice(start + next.index));
}

export const restored = (read: string, written: string): string => restoredSection(read, restoredSection(read, written, PROBLEM_STATEMENT), OUT_OF_SCOPE);

export const sectionsDropped = (read: string, written: string): string[] => [
  ...(section(written, PROBLEM_STATEMENT) === section(read, PROBLEM_STATEMENT) ? [] : ["the rewrite drops '## Problem Statement', the owner's words, which stay byte-identical"]),
  ...(section(written, OUT_OF_SCOPE) === section(read, OUT_OF_SCOPE) ? [] : ["the rewrite drops '## Out of Scope', which every ticket carries byte-identical"]),
];

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
  return [...refusals, ...emDashLines(text).map((line) => `line ${line} carries an em dash`)];
}

export function ticketRefusals(body: string): string[] {
  const text = body.replaceAll(/\r\n?/g, "\n");
  const refusals: string[] = [];
  if (!WHY.test(text)) refusals.push("the body carries no '## Why', so nothing says what the owner asked for");
  else if (!OWNER_WORDS.test(section(text, WHY))) refusals.push('\'## Why\' quotes no owner words: it carries no "..." quote and no > quoted line');
  if (!DONE_WHEN.test(text)) refusals.push("the body carries no '## Done when', so nothing says what done looks like");
  else {
    const said = itemsUnder(text, DONE_WHEN, BULLET).length;
    if (said < FEWEST || said > MOST) refusals.push(`'## Done when' carries ${said} '- ' sentences, not ${FEWEST} to ${MOST}`);
  }
  return [...refusals, ...emDashLines(text).map((line) => `line ${line} carries an em dash`)];
}

function pathRefusals(text: string): string[] {
  const found = [...new Set([...text.matchAll(FILE_PATH)].map(([path]) => path))];
  return found.map((path) => `'## Implementation Decisions' names \`${path}\`, a file path`);
}

function sentenceRefusals(items: string[]): string[] {
  const refusals: string[] = [];
  items.forEach((item, index) => {
    const attempts = item.match(ATTEMPT)?.length ?? 0;
    if (attempts === 0) return;
    const command = MARKER.exec(item)?.[1];
    const at = `sentence ${index + 1}`;
    if (attempts > 1) refusals.push(`${at} carries ${attempts} check: markers, not one: ${quoted(item)}`);
    else if (command === undefined) refusals.push(`${at} carries a check: marker that does not parse: ${quoted(item)}`);
  });
  return refusals;
}

export const SPEC_CAP = 64 * 1024;

export interface Sentence {
  said: string;
  check?: string;
}

export function sentences(body: string): Sentence[] {
  return itemsUnder(body.replaceAll(/\r\n?/g, "\n"), SENTENCES).map((item) => {
    const check = MARKER.exec(item);
    return check === null ? { said: item } : { said: item.slice(0, check.index).trim(), check: check[1] };
  });
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
  else refusals.push(...pathRefusals(section(text, IMPLEMENTATION_DECISIONS)));
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
    const sentences = itemsUnder(text, SENTENCES);
    if (sentences.length === 0) refusals.push("'## I'll know it works when I can' carries no '- [ ]' item, so the done check has nothing to try");
    else refusals.push(...sentenceRefusals(sentences));
  }
  const bytes = Buffer.byteLength(text);
  if (bytes > SPEC_CAP) refusals.push(`the body is ${bytes} bytes, over the spec cap of ${SPEC_CAP}`);
  return [...refusals, ...emDashLines(text).map((line) => `line ${line} carries an em dash`)];
}
