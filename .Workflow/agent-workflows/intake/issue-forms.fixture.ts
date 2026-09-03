import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * @fixture Reached only from the suite, by design.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEMPLATE_DIR = join(REPO_ROOT, ".github", "ISSUE_TEMPLATE");

export function readIssueForm<T = unknown>(name: string): T {
  return parse(readFileSync(join(TEMPLATE_DIR, name), "utf8")) as T;
}

export function listIssueForms(): string[] {
  return readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".yml") && f !== "config.yml");
}

export interface SourceFile {
  path: string;
  text: string;
}

export function readIssueWriterCandidates(): SourceFile[] {
  const roots = [
    join(REPO_ROOT, ".github", "workflows"),
    join(REPO_ROOT, ".Workflow", "agent-workflows"),
    join(REPO_ROOT, ".claude", "hooks"),
    join(REPO_ROOT, "bin"),
  ];
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!/\.(test|fake|fixture)\.ts$/.test(entry.name)) {
        out.push({ path: full.slice(REPO_ROOT.length + 1), text: readFileSync(full, "utf8") });
      }
    }
  };
  for (const root of roots) walk(root);
  return out;
}
