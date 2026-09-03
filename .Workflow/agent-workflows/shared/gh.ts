import { execFileSync } from "node:child_process";
import { childEnv } from "./child-env.ts";

export type GhExec = (args: string[]) => string;

export const execGh: GhExec = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, env: childEnv() });

interface RawComment {
  body?: string;
}

export function issueComments(gh: GhExec, issueNumber: number): string[] {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: RawComment[] };
  return (parsed.comments ?? []).map((comment) => comment.body ?? "");
}
