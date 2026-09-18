import { emDashLines } from "./em-dash.ts";

const WHY = /^##[ \t]+Why[ \t]*$/m;
const CRITERIA = /^##[ \t]+Acceptance criteria[ \t]*$/m;
const CLAIMED = /^##[ \t]+Files claimed[ \t]*$/m;
const NEXT_HEADING = /^##[ \t]/m;
const ITEM = /^[ \t]*-[ \t]*\[[ xX]\][ \t]*/;
const MARKER = /(?:–|(?<=[ \t])-{1,2}(?=[ \t]))[ \t]*check:[ \t]*`([^`\n]+)`[ \t]*$/;
const ATTEMPT = /check:/gi;
const RUNS_TESTS = /(?<![A-Za-z])(vitest|pytest|jest|node --test)(?![A-Za-z])/;
const OWNER_WORDS = /"[^"\n]{4,}"|^>[ \t]*\S/m;
const GLOB = /[*?[\]]/;
const FEWEST = 1;
const MOST = 3;
const QUOTE = 80;

function section(body: string, heading: RegExp): string {
  const found = heading.exec(body);
  if (found === null) return "";
  const rest = body.slice(found.index + found[0].length);
  const next = NEXT_HEADING.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

function criteria(body: string): string[] {
  const items: string[] = [];
  for (const line of section(body, CRITERIA).split("\n")) {
    if (ITEM.test(line)) items.push(line.replace(ITEM, "").trim());
    else if (items.length > 0 && line.trim() !== "") items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

export function claims(body: string): string[] {
  return section(body, CLAIMED)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.slice(1).replaceAll("`", "").trim())
    .filter((entry) => entry !== "");
}

export function quoted(text: string): string {
  return text.length > QUOTE ? `${text.slice(0, QUOTE - 1)}…` : text;
}

export function checks(body: string): { at: string; command: string }[] {
  return criteria(body.replaceAll(/\r\n?/g, "\n")).flatMap((item, index) => {
    const command = MARKER.exec(item)?.[1];
    return command === undefined ? [] : [{ at: `criterion ${index + 1}`, command }];
  });
}

function checkRefusals(items: string[]): string[] {
  const refusals: string[] = [];
  const commands: string[] = [];
  items.forEach((item, index) => {
    const attempts = item.match(ATTEMPT)?.length ?? 0;
    const command = MARKER.exec(item)?.[1];
    const at = `criterion ${index + 1}`;
    if (attempts === 0) refusals.push(`${at} carries no check: \`<command>\` marker: ${quoted(item)}`);
    else if (attempts > 1) refusals.push(`${at} carries ${attempts} check: markers, not one: ${quoted(item)}`);
    else if (command === undefined) refusals.push(`${at} carries a check: marker that does not parse: ${quoted(item)}`);
    else commands.push(command);
  });
  if (items.length > 0 && !commands.some((command) => RUNS_TESTS.test(command))) {
    refusals.push("no check runs tests: a grep or file check may sit beside a test check, never alone");
  }
  return refusals;
}

export function ticketRefusals(body: string): string[] {
  const text = body.replaceAll(/\r\n?/g, "\n");
  const refusals: string[] = [];
  if (!WHY.test(text)) refusals.push("the body carries no '## Why', so nothing says what the owner asked for");
  else if (!OWNER_WORDS.test(section(text, WHY))) refusals.push('\'## Why\' quotes no owner words: it carries no "..." quote and no > quoted line');
  if (!CRITERIA.test(text)) refusals.push("the body carries no '## Acceptance criteria'");
  else {
    const items = criteria(text);
    if (items.length < FEWEST || items.length > MOST) refusals.push(`'## Acceptance criteria' carries ${items.length} '- [ ]' items, not ${FEWEST} to ${MOST}`);
    refusals.push(...checkRefusals(items));
  }
  if (!CLAIMED.test(text)) refusals.push("the body carries no '## Files claimed'");
  else refusals.push(...claims(text).filter((entry) => GLOB.test(entry)).map((entry) => `'## Files claimed' names \`${quoted(entry)}\`, a glob rather than one file`));
  return [...refusals, ...emDashLines(text).map((line) => `line ${line} carries an em dash`)];
}
