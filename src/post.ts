import { spawnSync } from "node:child_process";
import { text as read } from "node:stream/consumers";
import { noteRefusals, ticketRefusals } from "./ticket-shape.ts";

export interface Posting {
  kind: string;
  text: string;
  title?: string;
}

export type Gh = (args: string[]) => { status: number | null; stdout: string; stderr: string };

const KINDS: Record<string, { refuses: (text: string) => string[]; label: string[] }> = {
  ticket: { refuses: ticketRefusals, label: [] },
  note: { refuses: noteRefusals, label: ["--label", "note"] },
};

export function post({ kind, text, title }: Posting, gh: Gh): { refusals: string[]; said: string } {
  const shape = KINDS[kind];
  if (shape === undefined) return { refusals: [`${kind} is not a kind src/post.ts writes: ${Object.keys(KINDS).join(", ")}`], said: "" };
  if (title === undefined) return { refusals: [`a ${kind} carries no title`], said: "" };
  const refused = shape.refuses(text);
  if (refused.length > 0) return { refusals: refused, said: "" };
  const args = ["issue", "create", "--title", title, ...shape.label, "--body", text];
  const { status, stdout, stderr } = gh(args);
  if (status !== 0) return { refusals: [`gh ${args[0]} ${args[1]} failed: ${(stderr || stdout).trim().split("\n")[0]}`], said: "" };
  return { refusals: [], said: stdout.trim() };
}

if (import.meta.main) {
  const [kind, title] = process.argv.slice(2);
  const { refusals, said } = post({ kind, text: await read(process.stdin), title }, (args) => spawnSync("gh", args, { encoding: "utf8" }));
  for (const refusal of refusals) console.error(refusal);
  if (said !== "") console.log(said);
  process.exit(refusals.length > 0 ? 1 : 0);
}
