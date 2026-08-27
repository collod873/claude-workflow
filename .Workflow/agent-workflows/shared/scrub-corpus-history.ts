import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGit, type GitExec } from "./git.ts";

/**
 * The one-time history rewrite #134 calls for (spec "The deletion, and the rewrite"): a single
 * `git filter-repo` pass that removes two things from a repository's reachable history —
 *
 * - `docs/research/session-prompts-2026-08.md`, entirely, at every commit that ever carried it;
 * - every version of `adr-corpus.evidence.json` *except* whatever is at `HEAD` right now — the
 *   fixture used to embed full research-note bodies, and those earlier blobs are the leak.
 *
 * The two paths get different treatment because they need it: the doc has no version worth
 * keeping, and the fixture's own current content is exactly what the rest of #134 (the generator
 * in `generate-contract.ts`'s sibling for the fixture) is supposed to keep producing. Deleting it
 * too would just be a second exposure the next commit re-fixes.
 */

/** The research note this rewrite removes outright, repo-relative. */
export const SESSION_PROMPTS_PATH = "docs/research/session-prompts-2026-08.md";

/** The fixture whose *prior* blobs this rewrite strips, keeping only what `HEAD` carries. */
export const ADR_CORPUS_EVIDENCE_PATH = ".Workflow/agent-workflows/watchdog/adr-corpus.evidence.json";

/**
 * Thrown when `git filter-repo` is not reachable on `PATH`. Named so a caller — the CLI below, or
 * a test — can tell "the tool is missing" apart from any other way the rewrite can fail, without
 * parsing a message string.
 */
export class GitFilterRepoNotFoundError extends Error {
  constructor() {
    super(
      "git filter-repo is not on PATH (https://github.com/newren/git-filter-repo). Refusing to " +
        "run rather than doing a partial history rewrite — install it and run this again.",
    );
    this.name = "GitFilterRepoNotFoundError";
  }
}

/** Whether `git filter-repo` is reachable on `PATH`, checked the same way it will be invoked. */
export function isGitFilterRepoAvailable(git: GitExec = execGit): boolean {
  try {
    git(["filter-repo", "--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every blob id `path` has carried at some commit reachable in `repoPath`'s history, other than
 * whatever blob currently sits at `HEAD:path` there. That exclusion is the whole mechanism behind
 * "leave the current tip's own content intact": `--strip-blobs-with-ids` (below) drops a path's
 * entry from any commit whose version of it matches one of these ids, and the id this function
 * leaves out of the set is the one id no commit should have its entry for `path` dropped over.
 *
 * A commit `git log` names for `path` but whose tree turns out not to contain it (a commit that
 * deleted it) is skipped rather than treated as an error — there is no blob there to collect.
 */
function priorBlobIds(repoPath: string, path: string, git: GitExec): string[] {
  let tipBlob = "";
  try {
    tipBlob = git(["-C", repoPath, "rev-parse", `HEAD:${path}`]).trim();
  } catch {
    // `path` doesn't exist at HEAD — every version in history is "prior", so nothing is excluded.
  }

  const commits = git(["-C", repoPath, "log", "--all", "--format=%H", "--", path])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const ids = new Set<string>();
  for (const commit of commits) {
    let blob: string;
    try {
      blob = git(["-C", repoPath, "rev-parse", `${commit}:${path}`]).trim();
    } catch {
      continue;
    }
    if (blob !== tipBlob) ids.add(blob);
  }
  return [...ids];
}

/**
 * Runs the rewrite described above against `repoPath`, in place. Throws
 * `GitFilterRepoNotFoundError` before touching the repo at all when the tool isn't on `PATH` — the
 * refusal this exists for, so a runner missing the tool never ends up holding half a rewrite.
 *
 * `--path … --invert-paths` drops `SESSION_PROMPTS_PATH` from every commit's tree outright.
 * `--strip-blobs-with-ids` drops `ADR_CORPUS_EVIDENCE_PATH`'s entry from any commit whose version
 * of it isn't the one at `HEAD`. Both run as the one filter-repo pass the spec calls for — commits
 * left with no changes by either filter are pruned by filter-repo itself, which is how a commit
 * that only ever touched these two paths disappears from history entirely rather than surviving
 * as an empty entry.
 *
 * `--force` is required here because `repoPath` is an existing checkout, not a fresh clone —
 * filter-repo's own safety check otherwise refuses to run against one. Irreversible either way,
 * which is why the caller, not this function, is the one deciding a rewrite belongs here at all.
 */
export function scrubCorpusHistory(repoPath: string, git: GitExec = execGit): void {
  if (!isGitFilterRepoAvailable(git)) {
    throw new GitFilterRepoNotFoundError();
  }

  const idsToStrip = priorBlobIds(repoPath, ADR_CORPUS_EVIDENCE_PATH, git);

  const workDir = mkdtempSync(join(tmpdir(), "scrub-corpus-history-"));
  try {
    const blobIdsPath = join(workDir, "strip-blob-ids.txt");
    writeFileSync(blobIdsPath, idsToStrip.map((id) => `${id}\n`).join(""));

    git([
      "-C",
      repoPath,
      "filter-repo",
      "--force",
      "--path",
      SESSION_PROMPTS_PATH,
      "--invert-paths",
      "--strip-blobs-with-ids",
      blobIdsPath,
    ]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// --- CLI -------------------------------------------------------------------------------------
//
// `node scrub-corpus-history.ts <repoPath>` runs the rewrite above against `<repoPath>` in place.
// Exits 1, naming `GitFilterRepoNotFoundError`, when `git filter-repo` isn't on `PATH`; exits 2 on
// a usage error; re-throws (and so exits non-zero with a stack trace) anything else, since nothing
// past this file knows how to recover a partial rewrite.
//
// Guarded with `pathToFileURL(process.argv[1])`, never a hand-built `file://${argv[1]}` — the
// latter loses percent-encoding on a path with a space, which is this repo's own real checkout
// path, and would make this guard silently never fire there.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const repoPath = process.argv[2];
  if (!repoPath) {
    console.error("usage: scrub-corpus-history.ts <repoPath>");
    process.exit(2);
  } else {
    try {
      scrubCorpusHistory(repoPath);
      console.log(`scrub-corpus-history: rewrote ${repoPath}`);
    } catch (err) {
      if (err instanceof GitFilterRepoNotFoundError) {
        console.error(`scrub-corpus-history: ${err.name}: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  }
}
