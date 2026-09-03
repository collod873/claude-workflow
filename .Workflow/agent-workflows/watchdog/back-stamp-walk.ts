import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { deriveBackStamps, type BackStampWrite, type DocFile } from "./back-stamp";

/**
 * The IO half of the back-stamp (#125, `./back-stamp.ts` is the judgement half,
 * `.github/workflows/back-stamp.yml` the wiring): reads `docs/adr/`, hands it to the judgement,
 * writes whatever comes back and commits it straight to `main`.
 *
 * **Fires on the add-event, not every push.**
 * [ADR-0046](../../../docs/adr/0046-the-backwards-question-writes-rather-than-reports-so-it-need.md):
 * *"a commit landing a new ADR is exactly the moment the answer can have changed, and it is the
 * moment the predecessor needs its stamp. No other push moves the graph, so every other push is
 * silent by construction rather than by a filter."* The workflow's `paths:` filter is that
 * construction — see `back-stamp.yml`. `docs/research/` is in the filter for the same reason,
 * though nothing under it can ever be a predecessor here (`back-stamp.ts`'s header says why); a
 * push that only touches a research note derives an empty write list and commits nothing.
 *
 * **The push this makes does not re-trigger the workflow.** A `GITHUB_TOKEN` push is exempted from
 * firing further workflow runs (the same property `shape-accept.yml` relies on), so a back-stamp
 * commit landing under `docs/adr/` cannot loop this lane into itself.
 *
 * **Recomputes, writes only what changed.** `deriveBackStamps` already returns nothing for a file
 * whose stamp is already correct, so a run that finds nothing to say commits nothing — the property
 * that makes a second run over an already-stamped tree a no-op.
 */

const ADR_DIR = "docs/adr";

/**
 * The second generated file under `docs/adr/`, alongside the corpus fixture: the table `adr-check`
 * renders from every landed ADR's title and `status:`, and `bin/gauntlet push`'s `adrs` check
 * refuses a stale one. A back-stamp *is* a `status:` edit — `constraint` becomes `superseded` — so
 * this lane stales it on every run that stamps anything (#356).
 */
export const INDEX_RELATIVE_PATH = `${ADR_DIR}/INDEX.md`;

export interface WalkDeps {
  /**
   * The checkout this walk reads, writes and commits into — `-C repoRoot` on every `git` call
   * below, and the prefix every `readDir`/`readFile`/`writeFile` path is joined onto. A caller
   * repository's own tree once this workflow is reusable (`back-stamp.yml`'s two checkouts): the
   * machine checkout that runs this script and the target checkout that owns `docs/adr/` are no
   * longer the same directory, so nothing here may assume the process's own `cwd` is the repo.
   */
  repoRoot: string;
  /** Repo-relative directory → the `.md` basenames in it. Throwing (a missing directory) is caught and treated as empty. */
  readDir: (dir: string) => string[];
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  /**
   * Regenerates `docs/adr/INDEX.md` — the corpus fixture's sibling, and the other generated file
   * this lane stales every time it stamps (see `INDEX_RELATIVE_PATH`). Returns whether the index
   * is now a file this commit should carry: `false` where there was none to regenerate, so
   * `commitAndPush` stages a pathspec that matches nothing rather than failing the whole run on it.
   *
   * Held at arm's length because the generator
   * is the machine-global `~/bin/adr-check` (ADR-0097 — never vendored here), which a hosted runner
   * does not carry, so the stand-down is an ordinary production state rather than an error path.
   */
  regenerateIndex: () => boolean;
  git: GitExec;
  log?: (line: string) => void;
}

export type WalkAction = "committed" | "clean";

export interface WalkOutcome {
  action: WalkAction;
  /** Paths written and committed, in the order the judgement returned them. `[]` on `clean`. */
  stamped: string[];
}

/** The `docs/adr/` corpus, as `back-stamp.ts` needs it. Only ADRs can ever be a predecessor here, so this is the whole input the judgement needs — see `back-stamp.ts`'s header. */
function readCorpus(deps: Pick<WalkDeps, "repoRoot" | "readDir" | "readFile">): DocFile[] {
  let names: string[];
  try {
    names = deps.readDir(join(deps.repoRoot, ADR_DIR));
  } catch {
    return []; // No docs/adr/ at all — a fixture tree, most likely. Nothing to stamp.
  }

  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${ADR_DIR}/${name}`)
    .map((path) => ({ path, content: deps.readFile(join(deps.repoRoot, path)) }));
}

export function backStampWalk(deps: WalkDeps): WalkOutcome {
  const log = deps.log ?? ((line: string) => console.log(line));

  const writes = deriveBackStamps(readCorpus(deps));
  if (writes.length === 0) {
    log("clean: no predecessor needs a back-stamp");
    return { action: "clean", stamped: [] };
  }

  for (const write of writes) deps.writeFile(join(deps.repoRoot, write.path), write.content);
  commitAndPush(deps, writes);

  const stamped = writes.map((write) => write.path);
  log(`stamped ${stamped.length}: ${stamped.join(", ")}`);
  return { action: "committed", stamped };
}

/**
 * Commits the back-stamped files and pushes straight to `main` — the same add-commit-push sequence
 * `shape/accept.ts` uses to land its own writes, including the fetch-and-rebase before the push:
 * this runs unattended off a push trigger, so a push that lands between the read and the write here
 * must be retried onto rather than silently overwritten.
 */
function commitAndPush(deps: WalkDeps, writes: BackStampWrite[]): void {
  const { repoRoot } = deps;
  const paths = writes.map((write) => write.path);

  // The index publishes the `status:` this stamp just
  // rewrote. Staged only when there was one to regenerate — see `WalkDeps.regenerateIndex`.
  if (deps.regenerateIndex()) paths.push(INDEX_RELATIVE_PATH);

  // `-C repoRoot` on every call — see `WalkDeps.repoRoot`.
  deps.git(["-C", repoRoot, "add", ...paths]);
  deps.git(["-C", repoRoot, "commit", "-m", commitMessage(writes)]);
  deps.git(["-C", repoRoot, "fetch", "origin", "main"]);
  deps.git(["-C", repoRoot, "rebase", "origin/main"]);
  deps.git(["-C", repoRoot, "push", "origin", "HEAD:main"]);
}

/** CLAUDE.md: commit messages explain **why**, not what. */
function commitMessage(writes: BackStampWrite[]): string {
  const names = writes.map((write) => write.path.split("/").pop()).join(", ");
  return `Back-stamp ${writes.length} predecessor${writes.length === 1 ? "" : "s"} a trailer already names

docs/adr/README.md said a superseded ADR gains a status line all along, and zero of 43 ever carried
one (ADR-0044) — a convention with no reader does not hold. This derives it from the Amends: trailer
its successor already wrote, so nobody has to remember: ${names}.`;
}

/**
 * `regenerateIndex`'s production half: `~/bin/adr-check --fix`, run with `repoRoot` as its working
 * directory because that tool finds its corpus from `cwd` rather than from its own location — the
 * same invocation `bin/gauntlet`'s `adrs` check and `bin/new-adr --land` make, and the same
 * machine-global binary rather than a copy vendored here (ADR-0097). A second renderer in this
 * repository would be diffed byte-for-byte against the first by the very check it exists to satisfy.
 *
 * Two stand-downs, both returning `false` so the caller stages nothing: a target with no index has
 * never adopted one — the rule `bin/gauntlet` already applies to a missing corpus fixture and a
 * missing clone baseline — and a machine with no `adr-check` is plumbing rather than a finding,
 * which is what a hosted runner is. There the index stays as stale as it is today; the owner's next
 * land regenerates it, and this lane no longer adds to the debt from the workstation.
 */
function regenerateAdrIndex(repoRoot: string): boolean {
  if (!existsSync(join(repoRoot, INDEX_RELATIVE_PATH))) return false;

  const adrCheck = join(process.env.HOME ?? "", "bin/adr-check");
  if (!existsSync(adrCheck)) return false;

  try {
    execFileSync(adrCheck, ["--fix"], { cwd: repoRoot, stdio: "ignore" });
  } catch {
    // A non-zero exit is the checker reporting its own findings — an ADR's shape, a dead citation
    // — which are the author's business at the push venue and not this lane's to answer. `--fix`
    // writes the index before it reports any of them, so the write this call exists for has
    // happened either way.
  }
  return true;
}

async function main(): Promise<void> {
  try {
    // `TARGET_WORKSPACE` is the reusable workflow's target checkout, `GITHUB_WORKSPACE` the
    // pre-reusable one (ADR-0055; seam described at `missing-trailer-counter.ts`).
    const repoRoot = process.env.TARGET_WORKSPACE ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
    const outcome = backStampWalk({
      repoRoot,
      readDir: (dir) => readdirSync(dir),
      readFile: (path) => readFileSync(path, "utf8"),
      writeFile: (path, content) => writeFileSync(path, content),
      regenerateIndex: () => regenerateAdrIndex(repoRoot),
      git: execGit,
    });
    console.log(`${outcome.action}: ${outcome.stamped.length} stamped`);
  } catch (err) {
    console.error(`back-stamp-walk failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
