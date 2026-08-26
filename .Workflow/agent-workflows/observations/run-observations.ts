import type { GitExec } from "../shared/git";
import type { StageExec } from "../shared/stage";
import { runAuditor, runProposedAuditor } from "./auditor";
import { parseViolationFindings } from "./lenses/violation";
import type { GatedProposedFinding } from "./lenses/proposed";
import type { Observation } from "./observation-schema";
import { readObservations, writeObservationNote } from "./notes";

const PROPOSED_LENS = "PROPOSED";
const VIOLATION_LENS = "VIOLATION";

export interface RunObservationsOptions {
  /** The injected git executor, threaded to the auditor and to this module's own notes read/write. */
  git: GitExec;
  /** The injected executor the auditor's sandboxed `claude -p` call runs through. */
  exec: StageExec;
  /** The repo the session's range diff and its notes both live in. */
  repoDir: string;
  /** The commit the session's range starts after (exclusive) — the diff is `base..head`. */
  base: string;
  /** The last commit in the session's own range — also where this run's findings are written. */
  head: string;
  /** Paths the transcript shows this session touching — see `sessionRangeDiff` for why an empty list restricts nothing. */
  touchedPaths?: string[];
  /** The session's captured conversation spine (capture's own format, spec #36 slice 1). */
  spine: string;
  /** Ratified `CODING_STANDARDS.md` text the VIOLATION lens checks the diff against. */
  standards: string;
}

/**
 * The observations pipeline's entrypoint (spec #36 slice 4/5, grown by spec
 * #63 to run both lenses): runs the PROPOSED auditor (`./auditor`'s
 * `runProposedAuditor`, which itself uses `./diff`'s `sessionRangeDiff`)
 * over one session's own commit range, folding in whatever this repo's
 * notes already carry as of `base`, then runs the VIOLATION pass
 * (`./auditor`'s `runAuditor`) over the same range and parses its raw text
 * with `parseViolationFindings` against the shared `Finding:`/`Site:`
 * grammar (`./lenses/grammar.ts`). VIOLATION carries no two-site gate — a
 * ratified rule broken once is broken — so every parsed finding is written
 * `released: true` on its first appearance, unlike PROPOSED's gated
 * findings. Both lenses' observations are merged into the single note
 * written on `head`. Imports the auditor rather than reimplementing any
 * part of it — this module owns only the git-notes read/write around it.
 */
export async function runObservations(options: RunObservationsOptions): Promise<Observation[]> {
  const { git, exec, repoDir, base, head, touchedPaths, spine, standards } = options;

  const priorFindings = loadPriorFindings({ git, repoDir, base });
  const gated = await runProposedAuditor({ git, exec, repoDir, base, head, touchedPaths, spine, priorFindings });
  const proposed: Observation[] = gated.map((finding) => ({ ...finding, lens: PROPOSED_LENS }));

  const violationRaw = await runAuditor({ git, exec, repoDir, base, head, touchedPaths, spine, standards });
  const violation: Observation[] = parseViolationFindings(violationRaw).map(({ finding, site }) => ({
    finding,
    lens: VIOLATION_LENS,
    sites: [site],
    released: true,
  }));

  const observations: Observation[] = [...proposed, ...violation];
  writeObservationNote({ git, repoDir, commit: head, observations });
  return observations;
}

/**
 * The two-site gate's memory going into this run: the PROPOSED findings the
 * most recent note at or before `base` already recorded. Each note a prior
 * run wrote is already `applyTwoSiteGate`'s full merged output at that
 * point, so the *nearest* one — not a union across every note in history —
 * is this run's starting state; `readObservations` returns commits newest
 * first, so that nearest note is its first result.
 */
function loadPriorFindings(options: { git: GitExec; repoDir: string; base: string }): GatedProposedFinding[] {
  const { git, repoDir, base } = options;
  const [mostRecent] = readObservations({ git, repoDir, head: base });
  if (!mostRecent) return [];
  return mostRecent.observations
    .filter((entry) => entry.lens === PROPOSED_LENS)
    .map(({ finding, sites, released }) => ({ finding, sites, released }));
}
