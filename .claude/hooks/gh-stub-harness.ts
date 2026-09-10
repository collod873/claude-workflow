import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const GH_STUB = `#!/usr/bin/env python3
import json
import os
import sys

argv = sys.argv[1:]
with open(os.environ["STUB_LOG"], "a") as fh:
    fh.write(json.dumps({"argv": argv, "env": dict(os.environ)}) + "\\n")

if argv and argv[0] in ("api", "repo") and ("-R" in argv or "--repo" in argv):
    sys.stderr.write("unknown shorthand flag: 'R'\\n")
    sys.exit(1)

if argv and argv[0] == "api" and "POST" not in argv:
    sys.stdout.write(os.environ.get("STUB_ISSUES", "[]"))
elif argv[:2] == ["issue", "create"]:
    sys.stdout.write(os.environ.get("STUB_URL", "") + "\\n")

sys.exit(0)
`;

/** @fixture the repository slug the #418 .proc. tests bind gh to; only those tests drive it. */
export const GH_REPO_SLUG = "acme/widgets";

/** @fixture one recorded gh invocation as the stub writes it; only the .proc. tests drive it. */
export type GhCall = { argv: string[]; env: Record<string, string> };

function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "bin", "gh_support.py"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`bin/gh_support.py not found above ${process.cwd()}`);
    dir = parent;
  }
}

/** @fixture the gh test double and temp checkout the #418 .proc. tests share; tests only. */
export function ghStubHarness() {
  const dir = mkdtempSync(join(tmpdir(), "gh-418-"));
  const gh = join(dir, "gh-stub.py");
  writeFileSync(gh, GH_STUB);
  chmodSync(gh, 0o755);
  const log = join(dir, "gh-calls.jsonl");
  const work = join(dir, "work");
  mkdirSync(join(work, ".git"), { recursive: true });
  mkdirSync(join(work, ".Workflow"), { recursive: true });
  return {
    dir,
    gh,
    work,
    binDir: join(repoRoot(), "bin"),
    env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        AGENT_SKILLS_GH: gh,
        STUB_LOG: log,
        ...extra,
      };
      delete env.GH_REPO;
      return env;
    },
    calls(): GhCall[] {
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as GhCall);
    },
  };
}

/** @fixture the repository-binding predicate the #418 .proc. tests share; tests only. */
export function namesRepo(call: GhCall): boolean {
  for (const flag of ["-R", "--repo"]) {
    const at = call.argv.indexOf(flag);
    if (at !== -1 && call.argv[at + 1] === GH_REPO_SLUG) return true;
  }
  return call.env.GH_REPO === GH_REPO_SLUG;
}
