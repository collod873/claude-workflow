import { execFileSync } from "node:child_process";
import { childEnv } from "./child-env.ts";
import { issuePath } from "./gh-paths.ts";

export type GhExec = (args: string[]) => string;

export const execGh: GhExec = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, env: childEnv() });

export function fetchIssueId(gh: GhExec, number: number): number {
  const raw = gh(["api", issuePath(number), "--jq", ".id"]);
  const id = Number(raw.trim());
  if (!Number.isInteger(id)) {
    throw new Error(`could not parse a numeric id for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return id;
}

interface RawComment {
  author?: { login?: string };
  createdAt?: string;
  body?: string;
}

export interface TicketComment {
  author: string;
  createdAt: string;
  body: string;
}

export function ticketComments(gh: GhExec, issueNumber: number): TicketComment[] {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: RawComment[] };
  return (parsed.comments ?? []).map((comment) => ({
    author: comment.author?.login ?? "unknown",
    createdAt: comment.createdAt ?? "",
    body: comment.body ?? "",
  }));
}

export function issueComments(gh: GhExec, issueNumber: number): string[] {
  return ticketComments(gh, issueNumber).map((comment) => comment.body);
}
