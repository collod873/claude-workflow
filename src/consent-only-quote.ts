import { text } from "node:stream/consumers";
import { meterLine } from "./meter-reviewer.ts";
import { why } from "./ticket-shape.ts";

const PASSAGE_LINE = /^>[ \t]?(.*)$/;
const WORD_LIMIT = 5;
const METER = "consent-only quote";

function passages(section: string): string[] {
  const found: string[] = [];
  let current: string[] = [];
  for (const line of section.split("\n")) {
    const quoted = PASSAGE_LINE.exec(line.trim());
    if (quoted) current.push(quoted[1] ?? "");
    else if (current.length > 0) {
      found.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) found.push(current.join(" "));
  return found;
}

function consentOnlyQuoteLine(body: string): string {
  const last = passages(why(body)).at(-1);
  if (last === undefined) return meterLine(METER, []);
  const words = last.split(/\s+/).filter((word) => word !== "");
  if (words.length > WORD_LIMIT) return meterLine(METER, []);
  return meterLine(METER, [`quoting "${last}" (${words.length} words)`]);
}

if (import.meta.main) process.stdout.write(`${consentOnlyQuoteLine(await text(process.stdin))}\n`);
