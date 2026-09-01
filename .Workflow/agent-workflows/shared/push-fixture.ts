import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Generate `docs/adr/INDEX.md` in a scratch push fixture, the way a real checkout does.
 *
 * The `adrs` check `bin/gauntlet push` runs regenerates the index and reports it stale when it
 * disagrees with the corpus, so a fixture that writes ADRs but no index is a repo that never ran
 * the tool — and its push goes red for a reason that has nothing to do with what it is testing.
 *
 * Lives here rather than inline in each fixture because both push fixtures need it and the clone
 * gate is right to refuse a second copy: the two files already carry as much duplication as this
 * repo has agreed to baseline.
 *
 * Skipped when the machine-global tool is absent — a CI runner has no `~/bin` — exactly as the
 * check itself stands down there.
 */
export function writeAdrIndex(root: string): void {
  const adrCheck = join(process.env.HOME ?? "", "bin/adr-check");
  if (!existsSync(adrCheck)) return;
  try {
    // `maxBuffer` matches `./git.ts` and `./gh.ts`, and for the same reason `exec-seams.test.ts`
    // holds every seam in this directory to it: Node's 1 MB default makes any output past it exit
    // `ENOBUFS`, an error that names neither the command nor the size.
    execFileSync(adrCheck, ["--fix"], { cwd: root, stdio: "ignore", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    // A non-zero exit is the check's own business; the fixture only needs the index written.
  }
}

/**
 * The two-document corpus both push fixtures seed so the `corpus` check has something real to
 * generate from, plus the index the `adrs` check expects beside it.
 *
 * Shared rather than spelled out twice: the ADR has to be written in the grammar the corpus
 * actually uses, and a second copy is a second place to forget that when the grammar next moves.
 */
export function seedCorpus(root: string): void {
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  mkdirSync(join(root, "docs/research"), { recursive: true });
  writeFileSync(
    join(root, "docs/adr/0001-a-decision.md"),
    "---\nstatus: constraint\ndate: 2026-08-20\nreversal: the fixture exists so the corpus " +
      "check has something real to generate from\n---\n\n# A decision that binds later work" +
      "\n\nWhy it binds.\n",
  );
  writeFileSync(
    join(root, "docs/research/topic-2026-08.md"),
    "**Resolves:** [x](https://example/1)\n\n## Section\n\nBody.\n",
  );
  writeAdrIndex(root);
}
