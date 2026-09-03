import type { GhExec } from "./gh";

/** One issue's body, as `gh issue view --json body` returns it — `""` when GitHub reports none. */
export function issueBody(gh: GhExec, issueNumber: number): string {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "body"]);
  return (JSON.parse(raw) as { body?: string }).body ?? "";
}
