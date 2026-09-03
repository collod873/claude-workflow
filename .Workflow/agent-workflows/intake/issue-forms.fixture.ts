import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * The two repo-rooted reads `intake.test.ts` makes, owned here the way `shared/read-workflow.ts`
 * owns the workflow directory's: the issue forms under `.github/ISSUE_TEMPLATE/`, and the walk over
 * every file that could plausibly hold a `gh` call or an API write. The test asserts on what comes
 * back and never touches the filesystem itself.
 *
 * @fixture Reached only from the suite, by design.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEMPLATE_DIR = join(REPO_ROOT, ".github", "ISSUE_TEMPLATE");

/** One issue form (or `config.yml`) by filename, parsed. `T` is the caller's to shape. */
export function readIssueForm<T = unknown>(name: string): T {
  return parse(readFileSync(join(TEMPLATE_DIR, name), "utf8")) as T;
}

/** Every form file in the template directory — `config.yml` is the chooser's own config, not a form. */
export function listIssueForms(): string[] {
  return readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".yml") && f !== "config.yml");
}

export interface SourceFile {
  /** Repo-relative, for a readable offender list. */
  path: string;
  text: string;
}

/**
 * Every file that could plausibly hold a `gh` call or an API write, read as text rather than
 * parsed, because the point is to catch the *next* writer whatever language it arrives in — a
 * workflow step, a stage, a hook — and the three languages involved share no AST. A test or a fake
 * naming the call it forbids is evidence, not a violation, so those are left out.
 */
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
