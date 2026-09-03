import type { GhExec } from "./gh";

export function issueBody(gh: GhExec, issueNumber: number): string {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "body"]);
  return (JSON.parse(raw) as { body?: string }).body ?? "";
}
