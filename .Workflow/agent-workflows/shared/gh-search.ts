import type { GhExec } from "./gh";

export function repositoriesByTopic(gh: GhExec, topic: string, perPage: number): string[] {
  const raw = gh(["api", "--paginate", `search/repositories?q=topic:${topic}&per_page=${perPage}`, "--jq", ".items[].full_name"]);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
