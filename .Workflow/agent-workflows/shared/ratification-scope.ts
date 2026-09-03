import type { GitExec } from "./git";
import type { Observation } from "./observation-schema";
import { readObservations } from "./notes";

export const DEFAULT_RATIFICATION_THRESHOLD = 20;

export function countReleasedObservations(observations: Observation[]): number {
  return observations.filter((observation) => observation.released).length;
}

export interface RatificationTriggerOptions {
  releasedCount: number;
  prdClosed: boolean;
  threshold?: number;
}

export function evaluateRatificationTrigger(options: RatificationTriggerOptions): { shouldRatify: boolean } {
  const { releasedCount, prdClosed, threshold = DEFAULT_RATIFICATION_THRESHOLD } = options;
  return { shouldRatify: prdClosed || releasedCount >= threshold };
}

export interface RangeCommit {
  sha: string;
  author: string;
  subject: string;
  body: string;
}

const MACHINERY_TRAILER = /^machinery-commit:\s*true\s*$/im;

export function isMachineryCommit(commit: RangeCommit): boolean {
  return MACHINERY_TRAILER.test(commit.body);
}

export const MACHINERY_TRAILER_LINE = "Machinery-Commit: true";

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

export interface RangeOptions {
  git: GitExec;
  repoDir: string;
  base?: string;
  head: string;
  isMachineryCommit?: (commit: RangeCommit) => boolean;
}

export interface CommitRange {
  base: string | undefined;
  head: string;
  commits: string[];
}

export function ratificationCommitRange(options: RangeOptions): CommitRange {
  const { git, repoDir, base, head, isMachineryCommit: isMachinery = isMachineryCommit } = options;
  const range = base ? `${base}..${head}` : head;
  const format = `%H${FIELD_SEP}%an <%ae>${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
  const raw = git(["-C", repoDir, "log", "--reverse", `--format=${format}`, range]);

  const commits: string[] = [];
  for (const record of raw.split(RECORD_SEP)) {
    if (!record.trim()) continue;

    const first = record.indexOf(FIELD_SEP);
    const second = record.indexOf(FIELD_SEP, first + 1);
    const third = record.indexOf(FIELD_SEP, second + 1);
    const commit: RangeCommit = {
      sha: record.slice(0, first).trim(),
      author: record.slice(first + 1, second),
      subject: record.slice(second + 1, third),
      body: record.slice(third + 1).trim(),
    };

    if (!isMachinery(commit)) commits.push(commit.sha);
  }

  return { base, head, commits };
}

export interface ScopeOptions extends RangeOptions {
  prdClosed: boolean;
  threshold?: number;
}

export interface RatificationScope {
  shouldRatify: boolean;
  releasedCount: number;
  range?: CommitRange;
}

export function computeRatificationScope(options: ScopeOptions): RatificationScope {
  const { git, repoDir, base, head, prdClosed, threshold, isMachineryCommit: isMachinery } = options;

  const seen = readObservations({ git, repoDir, base, head });
  const releasedCount = countReleasedObservations(seen.flatMap((entry) => entry.observations));
  const { shouldRatify } = evaluateRatificationTrigger({ releasedCount, prdClosed, threshold });

  if (!shouldRatify) return { shouldRatify, releasedCount };

  const range = ratificationCommitRange({ git, repoDir, base, head, isMachineryCommit: isMachinery });
  return { shouldRatify, releasedCount, range };
}
