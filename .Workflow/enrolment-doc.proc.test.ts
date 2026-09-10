import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function enrolmentDoc(): string {
  let dir = here;
  while (!existsSync(join(dir, "docs", "agents", "enrolment.md"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`no docs/agents/enrolment.md above ${here}`);
    dir = up;
  }
  return join(dir, "docs", "agents", "enrolment.md");
}

function names(pattern: string, flags: string[] = []): boolean {
  return spawnSync("grep", [...flags, "-q", "-e", pattern, enrolmentDoc()]).status === 0;
}

test(
  "#417.2: docs/agents/enrolment.md names CLAUDE_WORKFLOW_ROOT as how an enrolled repository's hooks reach _hook.mjs and _hook.sh, and says a repository enrols only with a GitHub remote",
  () => {
    expect(names("CLAUDE_WORKFLOW_ROOT")).toBe(true);
    expect(names("_hook\\.mjs")).toBe(true);
    expect(names("_hook\\.sh")).toBe(true);
    expect(names("GitHub remote", ["-i"])).toBe(true);
  },
);
