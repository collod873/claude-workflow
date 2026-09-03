import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GitExec } from "../shared/git.ts";

export function worktreeRoot(git: GitExec, sessionCwd: string): string | undefined {
  try {
    const root = git(["-C", sessionCwd, "rev-parse", "--show-toplevel"]).trim();
    return root || undefined;
  } catch {
    return undefined;
  }
}

export function toRepoRelative(paths: readonly string[], root: string): string[] {
  const rootResolved = resolve(root);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const candidate = isAbsolute(path) ? insideRoot(path, rootResolved) : path;
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

export { repoScoped } from "../shared/repo-scoped.ts";

function insideRoot(path: string, root: string): string | undefined {
  const rel = relative(root, resolve(path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}
