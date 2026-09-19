import { spawnSync } from "node:child_process";
import { text as read } from "node:stream/consumers";
import { parts, type Part } from "./parts.ts";
import { noteRefusals, ticketRefusals } from "./ticket-shape.ts";

export const LINE_LIMIT = 200;
export const MOST_LINES = 5;

export interface Posting {
  part: string;
  kind: string;
  text: string;
  target?: string;
}

export type Gh = (args: string[]) => { status: number | null; stdout: string; stderr: string };

interface Kind {
  refuses: (posting: Posting, part: Part) => string[];
  args: (posting: Posting) => string[];
}

export function linesAllowed(part: Part): number {
  return part.file.startsWith("core/hooks/") ? 1 : Math.min(part.lines ?? 1, MOST_LINES);
}

export function overLimit(said: string, allowed: number): string[] {
  const spoken = said.replace(/\n$/, "").split("\n");
  const long = spoken.filter((line) => line.length > LINE_LIMIT).map((line) => `said a line of ${line.length} characters, over ${LINE_LIMIT}`);
  return spoken.length > allowed ? [...long, `said ${spoken.length} lines, over ${allowed}`] : long;
}

const KINDS: Record<string, Kind> = {
  message: {
    refuses: (posting, part) =>
      posting.target === undefined
        ? ["a message names no issue to post it to"]
        : overLimit(posting.text, linesAllowed(part)).map((problem) => `${part.name} ${problem}`),
    args: (posting) => ["issue", "comment", posting.target ?? "", "--body", posting.text],
  },
  ticket: {
    refuses: (posting) => (posting.target === undefined ? ["a ticket carries no title"] : ticketRefusals(posting.text)),
    args: (posting) => ["issue", "create", "--title", posting.target ?? "", "--body", posting.text],
  },
  note: {
    refuses: (posting) => (posting.target === undefined ? ["a note carries no title"] : noteRefusals(posting.text)),
    args: (posting) => ["issue", "create", "--title", posting.target ?? "", "--label", "note", "--body", posting.text],
  },
};

export function post(posting: Posting, gh: Gh, registry: Part[] = parts): { refusals: string[]; said: string } {
  const part = registry.find((registered) => registered.name === posting.part);
  const kind = KINDS[posting.kind];
  if (part === undefined) return { refusals: [`${posting.part} is not a registered part, so it posts nothing`], said: "" };
  if (kind === undefined) return { refusals: [`${posting.kind} is not a kind core/post.ts writes: ${Object.keys(KINDS).join(", ")}`], said: "" };
  const refused = kind.refuses(posting, part);
  if (refused.length > 0) return { refusals: refused, said: "" };
  const args = kind.args(posting);
  const { status, stdout, stderr } = gh(args);
  if (status !== 0) return { refusals: [`gh ${args[0]} ${args[1]} failed: ${(stderr || stdout).trim().split("\n")[0]}`], said: "" };
  return { refusals: [], said: stdout.trim() };
}

if (import.meta.main) {
  const [part, kind, target] = process.argv.slice(2);
  const { refusals, said } = post({ part, kind, text: await read(process.stdin), target }, (args) => spawnSync("gh", args, { encoding: "utf8" }));
  for (const refusal of refusals) console.error(refusal);
  if (said !== "") console.log(said);
  process.exit(refusals.length > 0 ? 1 : 0);
}
