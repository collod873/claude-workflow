import type { GitExec } from "./git";
import { Observation } from "./observation-schema";
import { readNoteArray } from "./notes-store";
import { isBareSite, sitePath } from "./site";

/**
 * The notes ref every function in this module reads and writes, unqualified
 * so git resolves it under `refs/notes/observations` (git.ts's `-C <dir>`
 * convention: threaded through argv, never baked into a closure).
 */
const NOTES_REF = "observations";

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
  /**
   * Where the self-drop says what it dropped and why. Defaults to
   * `console.log`, matching `run-audit.ts`'s own convention: a finding
   * vanishing silently is the failure #108 was, so the default is the
   * loud one and a caller has to ask for quiet.
   */
  log?: (line: string) => void;
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
 *
 * The drop is a deletion of evidence, so it is narrated rather than silent
 * (#108): every dropped finding is logged with each of its sites, the path
 * that site resolved to, and which of the two things went wrong — the file
 * is gone, or the site was never a path in the first place. A site that
 * isn't a path is logged whether or not its finding survives, because that
 * is a defect in the lens that wrote it and the surviving case is the one
 * nothing else would ever report.
 */
export function readObservations(options: ReadObservationsOptions): CommitObservations[] {
  const { git, repoDir, base, head } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const range = base ? `${base}..${head}` : head;
  const results: CommitObservations[] = [];
  for (const { commit, records } of readNoteArray({ git, repoDir, ref: NOTES_REF, base, head, schema: Observation })) {
    const surviving = records.filter((entry) => hasLiveSite({ git, repoDir, ref: head, entry, log }));
    if (surviving.length > 0) results.push({ commit, observations: surviving });
  }
  return results;
}

/** One site of one finding, as the self-drop judged it. */
interface SiteVerdict {
  /** The site exactly as the note carries it. */
  site: string;
  /** The path `site` resolved to (`site.ts`'s `sitePath`). */
  path: string;
  /** Whether `site` was already a bare path — false means the lens wrote prose into it. */
  bare: boolean;
  /** Whether `path` exists at the ref being read. */
  exists: boolean;
}

function hasLiveSite(options: {
  git: GitExec;
  repoDir: string;
  ref: string;
  entry: Observation;
  log: (line: string) => void;
}): boolean {
  const { git, repoDir, ref, entry, log } = options;

  const verdicts: SiteVerdict[] = entry.sites.map((site) => {
    const path = sitePath(site);
    return { site, path, bare: isBareSite(site), exists: fileExistsAtRef({ git, repoDir, ref, path }) };
  });

  for (const verdict of verdicts.filter((each) => !each.bare)) {
    log(`note: ${entry.lens} finding "${entry.finding}" names a site that is not a path: ${JSON.stringify(verdict.site)} — read as ${verdict.path}`);
  }

  const live = verdicts.some((verdict) => verdict.exists);
  if (!live) {
    log(`dropped ${entry.lens} finding "${entry.finding}" as stale: ${verdicts.map((verdict) => describe(verdict, ref)).join("; ")}`);
  }
  return live;
}

/** Why one site failed to keep its finding alive, in the two ways that differ. */
function describe(verdict: SiteVerdict, ref: string): string {
  return verdict.bare
    ? `${verdict.path} does not exist at ${ref}`
    : `${JSON.stringify(verdict.site)} is not a path, and ${verdict.path} does not exist at ${ref}`;
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
