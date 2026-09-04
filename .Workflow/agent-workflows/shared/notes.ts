import type { GitExec } from "./git";
import { Observation } from "./observation-schema";
import { readNoteArray } from "./notes-store";
import { isBareSite, sitePath } from "./site";

const NOTES_REF = "observations";

export interface WriteObservationNoteOptions {
  git: GitExec;
  repoDir: string;
  commit: string;
  observations: Observation[];
}

export function writeObservationNote(options: WriteObservationNoteOptions): void {
  const { git, repoDir, commit, observations } = options;
  const message = JSON.stringify(Observation.array().parse(observations));
  git(["-C", repoDir, "notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", message, commit]);
}

export interface ReadObservationsOptions {
  git: GitExec;
  repoDir: string;
  base?: string;
  head: string;
  log?: (line: string) => void;
}

export interface CommitObservations {
  commit: string;
  observations: Observation[];
}

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

interface SiteVerdict {
  site: string;
  path: string;
  bare: boolean;
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
    log(`note: ${entry.lens} finding "${entry.finding}" names a site that is not a path: ${JSON.stringify(verdict.site)}, read as ${verdict.path}`);
  }

  const live = verdicts.some((verdict) => verdict.exists);
  if (!live) {
    log(`dropped ${entry.lens} finding "${entry.finding}" as stale: ${verdicts.map((verdict) => describe(verdict, ref)).join("; ")}`);
  }
  return live;
}

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
