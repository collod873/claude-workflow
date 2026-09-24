import { spawnSync } from "node:child_process";
import { text as read } from "node:stream/consumers";
import { emDashLines } from "./em-dash.ts";
import { noteRefusals, rewriteRefusals, ticketRefusals } from "./ticket-shape.ts";

export interface Posting {
  kind: string;
  text: string;
  title?: string;
  pr?: string;
}

export type Gh = (args: string[]) => { status: number | null; stdout: string; stderr: string };

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

function written(gh: Gh, args: string[]): { refusals: string[]; said: string } {
  const { status, stdout, stderr } = gh(args);
  if (status !== 0) return { refusals: [`gh ${args[0]} ${args[1]} failed: ${(stderr || stdout).trim().split("\n")[0]}`], said: "" };
  return { refusals: [], said: stdout.trim() };
}

export const commentOnTicket = (ticket: string, text: string, gh: Gh) => written(gh, ["issue", "comment", ticket, "--body", text]);

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
  const { kind, text } = posting;
  const shape = KINDS[kind];
  if (shape === undefined) return { refusals: [`${kind} is not a kind src/post.ts writes: ${Object.keys(KINDS).join(", ")}`], said: "" };
  const on = posting[shape.on];
  if (on === undefined) return { refusals: [`a ${kind} carries no ${shape.on}`], said: "" };
  const refused = shape.refuses(text);
  if (refused.length > 0) return { refusals: refused, said: "" };
  return written(gh, shape.args(on, text));
}

if (import.meta.main) {
  const [kind, title] = process.argv.slice(2);
  const { refusals, said } = post({ kind, text: await read(process.stdin), title }, (args) => spawnSync("gh", args, { encoding: "utf8" }));
  for (const refusal of refusals) console.error(refusal);
  if (said !== "") console.log(said);
  process.exit(refusals.length > 0 ? 1 : 0);
}
