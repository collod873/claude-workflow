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
