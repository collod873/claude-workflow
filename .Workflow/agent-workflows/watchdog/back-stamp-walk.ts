import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CORPUS_RELATIVE_PATH, writeCorpusFixture } from "../shared/generate-corpus-fixture";
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

export interface WalkDeps {
  /** Repo-relative directory → the `.md` basenames in it. Throwing (a missing directory) is caught and treated as empty. */
  readDir: (dir: string) => string[];
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  /**
   * Regenerates `adr-corpus.evidence.json` from `docs/adr` and `docs/research` — the same dep
   * `shape/accept.ts` holds for the same reason, held at arm's length here so a test can watch
   * *when* it runs relative to the `add` that stages it.
   *
   * A back-stamp edits an ADR body, and the fixture is a captured snapshot of those bodies. A
   * lane that writes the ADR and not the snapshot leaves the repository describing a corpus it no
   * longer has — which `bin/gauntlet push` refuses, and the `pre-push` hook installs itself on a
   * runner as readily as on the owner's machine. That refusal is correct and stays; what was
   * wrong is that this lane did not know it had grown the corpus. `6d72c1b` taught the accept
   * exactly this; the back-stamp is the second author that writes into `docs/adr/` and it was
   * never told.
   */
  regenerateCorpus: () => void;
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
function readCorpus(deps: Pick<WalkDeps, "readDir" | "readFile">): DocFile[] {
  let names: string[];
  try {
    names = deps.readDir(ADR_DIR);
  } catch {
    return []; // No docs/adr/ at all — a fixture tree, most likely. Nothing to stamp.
  }

  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${ADR_DIR}/${name}`)
    .map((path) => ({ path, content: deps.readFile(path) }));
}

export function backStampWalk(deps: WalkDeps): WalkOutcome {
  const log = deps.log ?? ((line: string) => console.log(line));

  const writes = deriveBackStamps(readCorpus(deps));
  if (writes.length === 0) {
    log("clean: no predecessor needs a back-stamp");
    return { action: "clean", stamped: [] };
  }

  for (const write of writes) deps.writeFile(write.path, write.content);
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
  const paths = writes.map((write) => write.path);

  // The fixture moves in the same commit as the stamps, because it is a snapshot of the bodies
  // those stamps just rewrote — see `regenerateCorpus`'s note on `WalkDeps` for why this lane
  // owns that and what it cost to learn.
  deps.regenerateCorpus();
  paths.push(CORPUS_RELATIVE_PATH);

  deps.git(["add", ...paths]);
  deps.git(["commit", "-m", commitMessage(writes)]);
  deps.git(["fetch", "origin", "main"]);
  deps.git(["rebase", "origin/main"]);
  deps.git(["push", "origin", "HEAD:main"]);
}

/** CLAUDE.md: commit messages explain **why**, not what. */
function commitMessage(writes: BackStampWrite[]): string {
  const names = writes.map((write) => write.path.split("/").pop()).join(", ");
  return `Back-stamp ${writes.length} predecessor${writes.length === 1 ? "" : "s"} a trailer already names

docs/adr/README.md said a superseded ADR gains a status line all along, and zero of 43 ever carried
one (ADR-0044) — a convention with no reader does not hold. This derives it from the Amends: trailer
its successor already wrote, so nobody has to remember: ${names}.`;
}

async function main(): Promise<void> {
  try {
    const outcome = backStampWalk({
      readDir: (dir) => readdirSync(dir),
      readFile: (path) => readFileSync(path, "utf8"),
      writeFile: (path, content) => writeFileSync(path, content),
      regenerateCorpus: () => writeCorpusFixture(process.cwd()),
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
