import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execGit, type GitExec } from "./git";
import { deletedPathMentions, type DriftFinding, renderDrift, retiredCitations, staleStamps, type TextFile } from "./prose-drift";
import { errorMessage } from "./reason";

const TRUNK = "origin/main";

function trackedTextFiles(root: string, git: GitExec): TextFile[] {
  return git(["-C", root, "ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .flatMap((path) => {
      try {
        if (!statSync(join(root, path)).isFile()) return [];
        const content = readFileSync(join(root, path), "utf8");
        return content.includes("\0") ? [] : [{ path, content }];
      } catch {
        return [];
      }
    });
}

export function gonePaths(root: string, git: GitExec): string[] {
  let base: string;
  try {
    base = git(["-C", root, "merge-base", "HEAD", TRUNK]).trim();
  } catch {
    return [];
  }
  return git(["-C", root, "diff", "--name-status", "-M", "--diff-filter=DR", base, "HEAD"])
    .split("\n")
    .filter(Boolean)
    .map((row) => row.split("\t")[1]);
}

export function driftFindings(root: string, git: GitExec): DriftFinding[] {
  const files = trackedTextFiles(root, git);
  return [...retiredCitations(files), ...staleStamps(files), ...deletedPathMentions(files, gonePaths(root, git))];
}

function main(): void {
  const named = process.argv[2] ?? process.env.TARGET_WORKSPACE;
  if (!named) {
    console.error("prose-drift: name the repository root as the first argument or in TARGET_WORKSPACE.");
    process.exitCode = 2;
    return;
  }
  try {
    const findings = driftFindings(resolve(named), execGit);
    if (findings.length === 0) return;
    console.error(renderDrift(findings));
    process.exitCode = 1;
  } catch (error) {
    console.error(`prose-drift: ${errorMessage(error)}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
