import type { GitExec } from "../shared/git";
import type { Observation } from "../observations/observation-schema";
import { readObservations } from "../observations/notes";

/**
 * Spec #36's starting N ("Start N = 20, and treat it as a number to be
 * measured rather than a constant to be defended" — open question 1).
 * Carried over from the deleted release channel unchanged: #296 replaces that
 * channel's *output shape*, not the two work-volume triggers ADR-0017 ruled
 * (see the ADR this ticket lands amending it).
 */
export const DEFAULT_RATIFICATION_THRESHOLD = 20;

/**
 * Counts the observations that have cleared the two-site gate
 * (`Observation.released`). A PROPOSED finding named at only one site is
 * recorded but `released: false` until a second site appears, so it does not
 * count toward the work-volume trigger. VIOLATION findings carry no gate of
 * their own and are written `released: true` from the start.
 */
export function countReleasedObservations(observations: Observation[]): number {
  return observations.filter((observation) => observation.released).length;
}

export interface RatificationTriggerOptions {
  releasedCount: number;
  /** True when this run was handed a PRD-close event. */
  prdClosed: boolean;
  /** Overridable per `DEFAULT_RATIFICATION_THRESHOLD`'s own doc. */
  threshold?: number;
}

/**
 * Spec #36's trigger, exactly, and ADR-0017's two work-volume events
 * verbatim: "Fires on: a PRD closing, OR N unreleased observations,
 * whichever comes first." Both halves are ORed, not chosen between. No clock
 * anywhere — every firing is caused by work having happened (ADR-0004).
 */
export function evaluateRatificationTrigger(options: RatificationTriggerOptions): { shouldRatify: boolean } {
  const { releasedCount, prdClosed, threshold = DEFAULT_RATIFICATION_THRESHOLD } = options;
  return { shouldRatify: prdClosed || releasedCount >= threshold };
}

/** One commit as `ratificationCommitRange`'s git-log read hands it to a machinery predicate. */
export interface RangeCommit {
  sha: string;
  /** `"Name <email>"`, as `%an <%ae>` formats it. Not used by the default predicate; available to an injected one. */
  author: string;
  subject: string;
  body: string;
}

/**
 * How this lane tells a pipeline-stage commit from real work: a
 * `Machinery-Commit: true` trailer in the commit body.
 *
 * The convention is no longer aspirational. Every commit the ratifier itself
 * authors carries this trailer (`./land.ts`), which is what keeps ADR-0017's
 * invariant true under the new shape: a ratifier landing can never feed the
 * next audit's scope, so a landing never triggers another pass.
 */
const MACHINERY_TRAILER = /^machinery-commit:\s*true\s*$/im;

export function isMachineryCommit(commit: RangeCommit): boolean {
  return MACHINERY_TRAILER.test(commit.body);
}

/** The trailer line every commit this lane authors carries — the sending half of `isMachineryCommit`. */
export const MACHINERY_TRAILER_LINE = "Machinery-Commit: true";

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

export interface RangeOptions {
  /** The injected git executor. Never invoked against the working tree. */
  git: GitExec;
  /** The repo to read, threaded as `-C <repoDir>` (see `git.ts`) — never baked into `git`'s closure. */
  repoDir: string;
  /** The commit already covered by a prior ratifier run (exclusive). Omit to scope from the repo's root. */
  base?: string;
  /** The last commit in scope. */
  head: string;
  /** Defaults to `isMachineryCommit` above. */
  isMachineryCommit?: (commit: RangeCommit) => boolean;
}

/** The commit range one ratifier run covers. */
export interface CommitRange {
  base: string | undefined;
  head: string;
  /** `base..head`, oldest first, with every commit `isMachineryCommit` flagged removed. */
  commits: string[];
}

/**
 * Reads `base..head` via one `GitExec` log call and returns it with the
 * machinery's own commits excluded — the filter ADR-0029 measured the absence
 * of (63% → 82% machinery share of file touches). Mirrors
 * `readObservations`'s own range convention (`base` exclusive, omitted to
 * read from the repo's root) so the two seams compose.
 */
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
  /** True when this run was handed a PRD-close event. */
  prdClosed: boolean;
  /** Overridable per `DEFAULT_RATIFICATION_THRESHOLD`'s own doc. */
  threshold?: number;
}

/** What one scope evaluation hands back. */
export interface RatificationScope {
  shouldRatify: boolean;
  /** How many observations in `base..head` have cleared the two-site gate. */
  releasedCount: number;
  /** Present only when `shouldRatify` is true — computing it costs a second git-log read. */
  range?: CommitRange;
}

/**
 * Whether a ratifier run is due, and what it covers: reads
 * `refs/notes/observations` for `base..head`, counts what has cleared the
 * two-site gate, decides against `evaluateRatificationTrigger`, and — only
 * when it fires — computes the commit range with the machinery's own commits
 * excluded.
 */
export function computeRatificationScope(options: ScopeOptions): RatificationScope {
  const { git, repoDir, base, head, prdClosed, threshold, isMachineryCommit: isMachinery } = options;

  const seen = readObservations({ git, repoDir, base, head });
  const releasedCount = countReleasedObservations(seen.flatMap((entry) => entry.observations));
  const { shouldRatify } = evaluateRatificationTrigger({ releasedCount, prdClosed, threshold });

  if (!shouldRatify) return { shouldRatify, releasedCount };

  const range = ratificationCommitRange({ git, repoDir, base, head, isMachineryCommit: isMachinery });
  return { shouldRatify, releasedCount, range };
}
