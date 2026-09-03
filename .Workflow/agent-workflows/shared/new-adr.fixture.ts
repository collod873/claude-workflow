import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeBareRepo, makeTempRepo, type TempRepo } from "./temp-repo.fixture.ts";

/**
 * Scratch trees for the two `bin/` authoring scripts, `bin/new-adr` and `bin/new-research`. Both
 * derive where they write from their own script path (`dirname "${BASH_SOURCE[0]}"/..`), not from
 * `cwd` — so "a scratch `docs/adr`" means a scratch *tree* carrying its own copy of the script,
 * and this file owns the read of the real `bin/` that copy is made from.
 *
 * `bin/node-on-path.sh` rides along with `new-adr` because `--land` sources it. The corpus
 * generator does not: `--land` skips the regeneration when the tree has none, which is what the
 * scratch trees exercise as much as the numbering.
 *
 * @fixture Reached only from `new-adr.proc.test.ts` and `new-research.proc.test.ts`, by design.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** Matches `./git.ts`'s, and for the same reason: Node's 1 MB default exits `ENOBUFS` naming neither command nor size. */
const MAX_BUFFER = 10 * 1024 * 1024;

/** Copies `bin/<name>` for each `names` entry into `<dir>/bin/`, executable. */
export function vendorBin(dir: string, ...names: string[]): void {
  mkdirSync(join(dir, "bin"), { recursive: true });
  for (const name of names) {
    writeFileSync(join(dir, "bin", name), readFileSync(join(REPO_ROOT, "bin", name), "utf8"), { mode: 0o755 });
  }
}

/**
 * A repo-shaped scratch tree with `bin/new-adr` in it, so the script's own `dirname/..` resolution
 * lands `docs/adr` inside the tree, never in the real repo. A git repository on `main` with no
 * remote — the shape a land with no `origin` degrades in.
 */
export function newAdrRepo(prefix: string): TempRepo {
  const repo = makeTempRepo(prefix);
  vendorBin(repo.dir, "new-adr", "node-on-path.sh");
  return repo;
}

/**
 * A scratch tree whose `origin` already carries `docs/adr/<taken>-landed.md` on `main`, plus
 * whatever uncommitted state the caller adds — the two-author split from
 * [#146](https://github.com/collod873/claude-workflow/issues/146), staged locally: a remote the
 * other author has already pushed to, and a working tree that has not seen it.
 */
export function twoAuthorRepo(taken: string): TempRepo {
  const origin = makeBareRepo("new-adr-origin");

  const seed = makeTempRepo("new-adr-seed", { origin });
  seed.write(`docs/adr/${taken}-landed.md`, `# The other author got here first\n\nRecorded 2026-08-27.\n`);
  seed.commit("seed");
  seed.git("push", "--quiet", "origin", "main");

  const work = makeTempRepo("new-adr-work", { origin });
  vendorBin(work.dir, "new-adr", "node-on-path.sh");
  mkdirSync(join(work.dir, "docs/adr"), { recursive: true });
  return work;
}

/**
 * Runs `<root>/bin/new-adr` with `args` and returns the path it printed. `extraEnv` is the seam
 * the `TARGET_WORKSPACE` and `HOME` cases need: run the script from one tree while pointing it at
 * another checkout, or at another machine's `~/bin`.
 *
 * `EDITOR`/`VISUAL` are stripped so a set editor never `exec`s over the test and hangs it —
 * `bin/new-adr` opens the created file in `$EDITOR` when one is set and stdout is a terminal.
 */
export function runNewAdr(root: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const env = { ...process.env, ...extraEnv };
  delete env.EDITOR;
  delete env.VISUAL;
  return execFileSync(join(root, "bin/new-adr"), args, { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER, env }).trim();
}
