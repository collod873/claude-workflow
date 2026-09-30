import { spawnSync } from "node:child_process";
import { text as read } from "node:stream/consumers";
import { emDashLines } from "./em-dash.ts";
import { NOTE_SHAPE, SPEC_SHAPE, TICKET_SHAPE, matchEnd, noteRefusals, rewriteRefusals, specRefusals, ticketRefusals } from "./ticket-shape.ts";

export interface Posting {
  kind: string;
  text: string;
  title?: string;
  pr?: string;
  sessionId?: string;
  labels?: string[];
}

export type Gh = (args: string[]) => { status: number | null; stdout: string; stderr: string };

export const gh: Gh = (args) => spawnSync("gh", args, { encoding: "utf8", maxBuffer: Infinity });
export const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8", maxBuffer: Infinity });

interface Kind {
  refuses: (text: string) => string[];
  on: "title" | "pr";
  args: (on: string, text: string) => string[];
  shape?: string;
}

const filed = (refuses: (text: string) => string[], label: string[], shape: string): Kind => ({
  refuses,
  shape,
  on: "title",
  args: (title, text) => ["issue", "create", "--title", title, ...label, "--body", text],
});

const judgementRefusals = (text: string): string[] => emDashLines(text).map((line) => `line ${line} carries an em dash`);

export const RESEARCH = "research";
export const WAITING = "waiting";

const KINDS: Record<string, Kind> = {
  ticket: filed(ticketRefusals, [], TICKET_SHAPE),
  note: filed(noteRefusals, ["--label", "note"], NOTE_SHAPE),
  research: filed(noteRefusals, ["--label", "note", "--label", RESEARCH], NOTE_SHAPE),
  spec: filed(specRefusals, ["--label", "spec"], SPEC_SHAPE),
  judgement: { refuses: judgementRefusals, on: "pr", args: (pr, text) => ["pr", "comment", pr, "--body", text] },
};

const FIRST_HEADING = /^##[ \t].*$/m;
const NEXT_HEADING = /^##[ \t]/m;

function stampedWithSession(text: string, sessionId: string): string {
  const line = `Session: \`${sessionId}\``;
  const found = FIRST_HEADING.exec(text);
  if (found === null) return text;
  const start = matchEnd(found);
  const next = NEXT_HEADING.exec(text.slice(start));
  const end = next === null ? text.length : start + next.index;
  const section = text.slice(start, end).replace(/\s+$/, "");
  if (section.includes(line)) return text;
  return `${text.slice(0, start)}${section}\n\n${line}\n\n${text.slice(end)}`;
}

function written(gh: Gh, args: string[]): { refusals: string[]; said: string } {
  const { status, stdout, stderr } = gh(args);
  if (status !== 0) return { refusals: [`gh ${args[0]} ${args[1]} failed: ${(stderr || stdout).trim().split("\n")[0]}`], said: "" };
  return { refusals: [], said: stdout.trim() };
}

export const commentOnTicket = (ticket: string, text: string, gh: Gh) => written(gh, ["issue", "comment", ticket, "--body", text]);

export const OWNER = "collod873";
const TRUSTED = new Set([`User ${OWNER}`, "Bot collod873-machine[bot]"]);

const trusted = (said: unknown): said is { author: string; body: string } =>
  typeof said === "object" &&
  said !== null &&
  "author" in said &&
  typeof said.author === "string" &&
  "type" in said &&
  "body" in said &&
  typeof said.body === "string" &&
  TRUSTED.has(`${String(said.type)} ${said.author}`);

export function authoredOn(number: string, gh: Gh): { author: string; body: string }[] | undefined {
  const got = gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${number}/comments`, "--jq", ".[] | {author: .user.login, type: .user.type, body}"]);
  if (got.status !== 0) return undefined;
  try {
    return got.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line): unknown => JSON.parse(line))
      .filter(trusted)
      .map(({ author, body }) => ({ author, body }));
  } catch {
    return undefined;
  }
}

export const commentsOn = (number: string, gh: Gh): string[] | undefined => authoredOn(number, gh)?.map(({ body }) => body);

export function prNumber(branch: string, gh: Gh): string | undefined {
  const got = gh(["pr", "view", branch, "--json", "number", "--jq", ".number"]);
  const number = got.status === 0 ? got.stdout.trim() : "";
  return number === "" ? undefined : number;
}

export interface Asked {
  title: string;
  body: string;
  labels: { name: string }[];
}

export function askedIssue(stdout: string): Asked | undefined {
  try {
    const asked = JSON.parse(stdout) as Partial<Asked>;
    return typeof asked.title === "string" && typeof asked.body === "string" && Array.isArray(asked.labels) ? (asked as Asked) : undefined;
  } catch {
    return undefined;
  }
}

export const commentOnPr = (pr: string, text: string, gh: Gh) => written(gh, ["pr", "comment", pr, "--body", text]);

export function rewriteTicket(ticket: string, read: string, rewrite: string, gh: Gh): { refusals: string[]; said: string } {
  const refused = rewriteRefusals(read, rewrite);
  return refused.length > 0 ? { refusals: refused, said: "" } : written(gh, ["issue", "edit", ticket, "--body", rewrite]);
}

function prepared(posting: Posting): { refusals: string[]; args: string[] } {
  const { kind, sessionId } = posting;
  const shape = KINDS[kind];
  if (shape === undefined) return { refusals: [`${kind} is not a kind src/post.ts writes: ${Object.keys(KINDS).join(", ")}`], args: [] };
  const on = posting[shape.on];
  if (on === undefined) return { refusals: [`a ${kind} carries no ${shape.on}`], args: [] };
  const text = shape.on === "title" && sessionId ? stampedWithSession(posting.text, sessionId) : posting.text;
  const refused = shape.refuses(text);
  const labelled = (posting.labels ?? []).flatMap((label) => ["--label", label]);
  return refused.length > 0 ? { refusals: refused, args: [] } : { refusals: [], args: [...shape.args(on, text), ...labelled] };
}

function shapesFiled(): string[] {
  const kindsOf = new Map<string, string[]>();
  for (const [kind, { shape }] of Object.entries(KINDS)) if (shape !== undefined) kindsOf.set(shape, [...(kindsOf.get(shape) ?? []), kind]);
  return [...kindsOf].map(([shape, kinds]) => `${kinds.join(", ")}: ${shape}`);
}

export const postRefusals = (posting: Posting): string[] => prepared(posting).refusals;

export function post(posting: Posting, gh: Gh): { refusals: string[]; said: string } {
  const { refusals, args } = prepared(posting);
  return refusals.length > 0 ? { refusals, said: "" } : written(gh, args);
}

if (import.meta.main) {
  const [kind, title, sessionId] = process.argv.slice(2);
  if (kind === undefined) throw new Error("no kind of posting in the arguments to post");
  if (kind === "--help") {
    console.log(shapesFiled().join("\n"));
    process.exit(0);
  }
  const { refusals, said } = post({ kind, text: await read(process.stdin), title, sessionId }, gh);
  for (const refusal of refusals) console.error(refusal);
  if (said !== "") console.log(said);
  process.exit(refusals.length > 0 ? 1 : 0);
}
