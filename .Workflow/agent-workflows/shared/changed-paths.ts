import type { GitExec } from "./git";

export function changedPaths(git: GitExec): string[] {
  return git(["status", "--porcelain", "-uall"])
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3))
    .map((path) => {
      const arrow = path.indexOf(" -> ");
      return arrow === -1 ? path : path.slice(arrow + 4);
    })
    .map((path) => (path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path));
}

function diffedPaths(diff: string): Set<string> {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) paths.add(line.slice(4).replace(/^b\//, ""));
  }
  return paths;
}

export function describeAttempt(git: GitExec): string {
  const diff = git(["diff"]);
  const shown = diffedPaths(diff);
  const untracked = changedPaths(git).filter((path) => !shown.has(path));
  return untracked.length === 0 ? diff : [diff, "Untracked:", ...untracked.map((path) => `- ${path}`)].join("\n");
}
