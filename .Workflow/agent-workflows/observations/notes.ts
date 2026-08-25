import type { GitExec } from "../shared/git";
import { Observation } from "./observation-schema";

/**
 * The notes ref every function in this module reads and writes, unqualified
 * so git resolves it under `refs/notes/observations` (git.ts's `-C <dir>`
 * convention: threaded through argv, never baked into a closure).
 */
const NOTES_REF = "observations";

/** A record separator no JSON `Observation[]` payload can contain. */
const RECORD_SEP = "\x1e";
/** Separates a commit hash from its note text within one record. */
const FIELD_SEP = "\x1f";

export interface WriteObservationNoteOptions {
  git: GitExec;
  /** The repo to write into, threaded as `-C <repoDir>` — never baked into `git`'s closure. */
  repoDir: string;
  /** The commit these findings are about. */
  commit: string;
  observations: Observation[];
}

/**
 * Writes `observations` as one git note on `refs/notes/observations`, keyed
 * to `commit`. Overwrites (`-f`) whatever note already sits on that commit —
 * a caller always hands this the full merged set (the two-site gate's own
 * output, `lenses/proposed.ts`'s `applyTwoSiteGate`), never a delta to
 * append, so there is nothing to merge with here.
 */
export function writeObservationNote(options: WriteObservationNoteOptions): void {
  const { git, repoDir, commit, observations } = options;
  const message = JSON.stringify(Observation.array().parse(observations));
  git(["-C", repoDir, "notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", message, commit]);
}

export interface ReadObservationsOptions {
  git: GitExec;
  /** The repo to read from, threaded as `-C <repoDir>`. */
  repoDir: string;
  /** The commit the range starts after (exclusive). Omit to read from the repo's root. */
  base?: string;
  /**
   * The last commit in the range — also the ref the staleness self-drop
   * checks every site's file against.
   */
  head: string;
}

/** One commit's surviving observations, as `readObservations` hands them back. */
export interface CommitObservations {
  commit: string;
  observations: Observation[];
}

/**
 * Reads every observation note in the range, the equivalent of
 * `git log <range> --notes=observations`, keyed to the exact commit each
 * note was written on.
 *
 * A finding is a claim about a site (`file:line`) that nothing re-checks
 * once it's written — so before a finding is returned, this checks that at
 * least one of its sites' files still exists at `head`. A finding whose only
 * sites are all gone is dropped: the staleness self-drop. A commit left with
 * no surviving findings after that filter is omitted entirely rather than
 * returned with an empty `observations` array.
 */
export function readObservations(options: ReadObservationsOptions): CommitObservations[] {
  const { git, repoDir, base, head } = options;
  const range = base ? `${base}..${head}` : head;
  const format = `%H${FIELD_SEP}%N${RECORD_SEP}`;
  const raw = git(["-C", repoDir, "log", range, `--notes=${NOTES_REF}`, `--format=${format}`]);

  const results: CommitObservations[] = [];
  for (const record of raw.split(RECORD_SEP)) {
    if (!record.trim()) continue;

    const sepIndex = record.indexOf(FIELD_SEP);
    const commit = (sepIndex === -1 ? record : record.slice(0, sepIndex)).trim();
    const note = (sepIndex === -1 ? "" : record.slice(sepIndex + FIELD_SEP.length)).trim();
    if (!note) continue;

    const observations = Observation.array().parse(JSON.parse(note));
    const surviving = observations.filter((entry) => hasLiveSite({ git, repoDir, ref: head, entry }));
    if (surviving.length > 0) results.push({ commit, observations: surviving });
  }
  return results;
}

function hasLiveSite(options: { git: GitExec; repoDir: string; ref: string; entry: Observation }): boolean {
  const { git, repoDir, ref, entry } = options;
  return entry.sites.some((site) => fileExistsAtRef({ git, repoDir, ref, path: sitePath(site) }));
}

/**
 * A site is `file:line` (`lenses/proposed.ts`'s `Site:` output). Strips a
 * trailing `:<line>` when present; a path with no line suffix is returned
 * unchanged.
 */
function sitePath(site: string): string {
  const lastColon = site.lastIndexOf(":");
  if (lastColon === -1) return site;
  const suffix = site.slice(lastColon + 1);
  return /^\d+$/.test(suffix) ? site.slice(0, lastColon) : site;
}

function fileExistsAtRef(options: { git: GitExec; repoDir: string; ref: string; path: string }): boolean {
  const { git, repoDir, ref, path } = options;
  try {
    git(["-C", repoDir, "cat-file", "-e", `${ref}:${path}`]);
    return true;
  } catch {
    return false;
  }
}
