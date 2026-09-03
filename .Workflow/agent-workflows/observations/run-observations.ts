import type { GitExec } from "../shared/git";
import type { StageExec } from "../shared/stage";
import { runAuditor, runProposedAuditor } from "./auditor";
import { parseViolationFindings } from "./lenses/violation";
import type { GatedProposedFinding } from "./lenses/proposed";
import { PROPOSED_LENS, VIOLATION_LENS, type Observation } from "../shared/observation-schema";
import { readObservations, writeObservationNote } from "../shared/notes";

export interface RunObservationsOptions {
  git: GitExec;
  exec: StageExec;
  repoDir: string;
  base: string;
  head: string;
  touchedPaths?: string[];
  spine: string;
  standards: string;
}

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

function loadPriorFindings(options: { git: GitExec; repoDir: string; base: string }): GatedProposedFinding[] {
  const { git, repoDir, base } = options;
  const [mostRecent] = readObservations({ git, repoDir, head: base });
  if (!mostRecent) return [];
  return mostRecent.observations
    .filter((entry) => entry.lens === PROPOSED_LENS)
    .map(({ finding, sites, released }) => ({ finding, sites, released }));
}
