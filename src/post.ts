import { spawnSync } from "node:child_process";
import { text as read } from "node:stream/consumers";
import { emDashLines } from "./em-dash.ts";
import { noteRefusals, rewriteRefusals, ticketRefusals, why } from "./ticket-shape.ts";

export interface Posting {
  kind: string;
  text: string;
  title?: string;
  pr?: string;
  sessionId?: string;
}

export type Gh = (args: string[]) => { status: number | null; stdout: string; stderr: string };

export const gh: Gh = (args) => spawnSync("gh", args, { encoding: "utf8", maxBuffer: Infinity });
export const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8", maxBuffer: Infinity });

interface Kind {
  refuses: (text: string) => string[];
  on: "title" | "pr";
  args: (on: string, text: string) => string[];
}

const filed = (refuses: (text: string) => string[], label: string[]): Kind => ({
  refuses,
  on: "title",
  args: (title, text) => ["issue", "create", "--title", title, ...label, "--body", text],
});

const judgementRefusals = (text: string): string[] => emDashLines(text).map((line) => `line ${line} carries an em dash`);

const KINDS: Record<string, Kind> = {
  ticket: filed(ticketRefusals, []),
  note: filed(noteRefusals, ["--label", "note"]),
  judgement: { refuses: judgementRefusals, on: "pr", args: (pr, text) => ["pr", "comment", pr, "--body", text] },
};

const WHY_HEADING = /^##[ \t]+Why[ \t]*$/m;
const NEXT_HEADING = /^##[ \t]/m;

function stampedWithSession(text: string, sessionId: string): string {
  const line = `Session: \`${sessionId}\``;
  if (why(text).includes(line)) return text;
  const found = WHY_HEADING.exec(text);
  if (found === null) return text;
  const start = found.index + found[0].length;
  const next = NEXT_HEADING.exec(text.slice(start));
  const end = next === null ? text.length : start + next.index;
  const section = text.slice(start, end).replace(/\s+$/, "");
  return `${text.slice(0, start)}${section}\n\n${line}\n\n${text.slice(end)}`;
}

function written(gh: Gh, args: string[]): { refusals: string[]; said: string } {
  const { status, stdout, stderr } = gh(args);
  if (status !== 0) return { refusals: [`gh ${args[0]} ${args[1]} failed: ${(stderr || stdout).trim().split("\n")[0]}`], said: "" };
  return { refusals: [], said: stdout.trim() };
}

export const commentOnTicket = (ticket: string, text: string, gh: Gh) => written(gh, ["issue", "comment", ticket, "--body", text]);

const TRUSTED = new Set(["User collod873", "Bot collod873-machine[bot]"]);

const trusted = (said: unknown): said is { body: string } =>
  typeof said === "object" && said !== null && "author" in said && "type" in said && "body" in said && typeof said.body === "string" && TRUSTED.has(`${said.type} ${said.author}`);

export function commentsOn(number: string, gh: Gh): string[] | undefined {
  const got = gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${number}/comments`, "--jq", ".[] | {author: .user.login, type: .user.type, body}"]);
  if (got.status !== 0) return undefined;
  try {
    return got.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line): unknown => JSON.parse(line))
      .filter(trusted)
      .map((said) => said.body);
  } catch {
    return undefined;
  }
}

export function prNumber(branch: string, gh: Gh): string | undefined {
  const got = gh(["pr", "view", branch, "--json", "number", "--jq", ".number"]);
  const number = got.status === 0 ? got.stdout.trim() : "";
  return number === "" ? undefined : number;
}

export const commentOnPr = (pr: string, text: string, gh: Gh) => written(gh, ["pr", "comment", pr, "--body", text]);

export function openPr(ticket: string, gh: Gh): string | undefined {
  const got = gh(["pr", "view", `ticket/${ticket}`, "--json", "state,url", "--jq", 'select(.state == "OPEN") | .url']);
  const url = got.status === 0 ? got.stdout.trim() : "";
  return url === "" ? undefined : url;
}

export function rewriteTicket(ticket: string, read: string, rewrite: string, gh: Gh): { refusals: string[]; said: string } {
  const refused = rewriteRefusals(read, rewrite);
  return refused.length > 0 ? { refusals: refused, said: "" } : written(gh, ["issue", "edit", ticket, "--body", rewrite]);
}

export function post(posting: Posting, gh: Gh): { refusals: string[]; said: string } {
  const { kind, sessionId } = posting;
  const shape = KINDS[kind];
  if (shape === undefined) return { refusals: [`${kind} is not a kind src/post.ts writes: ${Object.keys(KINDS).join(", ")}`], said: "" };
  const on = posting[shape.on];
  if (on === undefined) return { refusals: [`a ${kind} carries no ${shape.on}`], said: "" };
  const text = shape.on === "title" && sessionId ? stampedWithSession(posting.text, sessionId) : posting.text;
  const refused = shape.refuses(text);
  if (refused.length > 0) return { refusals: refused, said: "" };
  return written(gh, shape.args(on, text));
}

if (import.meta.main) {
  const [kind, title, sessionId] = process.argv.slice(2);
  const { refusals, said } = post({ kind, text: await read(process.stdin), title, sessionId }, gh);
  for (const refusal of refusals) console.error(refusal);
  if (said !== "") console.log(said);
  process.exit(refusals.length > 0 ? 1 : 0);
}
