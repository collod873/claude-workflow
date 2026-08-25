import type { GitExec } from "../shared/git";
import type { Observation } from "./observation-schema";
import { readObservations } from "./notes";

/**
 * Spec #36's starting N ("Start N = 20, and treat it as a number to be
 * measured rather than a constant to be defended" — open question 1).
 * Exported so a caller can report on it, or override it, without editing
 * this module.
 */
export const DEFAULT_RELEASE_THRESHOLD = 20;

/**
 * Counts the observations in `observations` that have cleared the two-site
 * gate (`Observation.released`, `observation-schema.ts`). A PROPOSED finding
 * named at only one site is recorded but `released: false` until a second
 * site appears — spec #36 is explicit that such a finding "is never
 * released," so it does not count toward the work-volume trigger either.
 * VIOLATION findings carry no gate of their own and are written `released:
 * true` from the start, so they count as soon as they exist.
 */
export function countReleasedObservations(observations: Observation[]): number {
  return observations.filter((observation) => observation.released).length;
}

export interface ReleaseTriggerOptions {
  /** From `countReleasedObservations` (or `computeReleaseScope`'s own call to it). */
  releasedCount: number;
  /** True when this run was handed a PRD-close event. */
  prdClosed: boolean;
  /** Overridable per `DEFAULT_RELEASE_THRESHOLD`'s own doc. Defaults to 20. */
  threshold?: number;
}

export interface ReleaseTrigger {
  /** Fires on a PRD close, or `releasedCount` reaching `threshold` — whichever comes first (spec #36 §Solution). */
  shouldRelease: boolean;
}

/**
 * Spec #36's release trigger, exactly: "Fires on: a PRD closing, OR N
 * unreleased observations, whichever comes first." Both halves are ORed, not
 * chosen between — a quiet PRD close still releases whatever accumulated,
 * and a quiet PRD with 20 observations still releases without one closing.
 */
export function evaluateReleaseTrigger(options: ReleaseTriggerOptions): ReleaseTrigger {
  const { releasedCount, prdClosed, threshold = DEFAULT_RELEASE_THRESHOLD } = options;
  return { shouldRelease: prdClosed || releasedCount >= threshold };
}

/** One commit as `releaseCommitRange`'s git-log read hands it to a machinery predicate. */
export interface ReleaseRangeCommit {
  sha: string;
  /** `"Name <email>"`, as `%an <%ae>` formats it. Not used by the default predicate; available to an injected one. */
  author: string;
  subject: string;
  body: string;
}

/**
 * The default way this module tells a pipeline-stage commit from real work:
 * a `Machinery-Commit: true` trailer in the commit body. No prior art names
 * this convention — spec #36 only requires *that* the machinery's own
 * commits are excluded, not *how* they're marked — so this is the
 * implementer's call, chosen for the same reason drain workers already stamp
 * `Part of #<n>` into a commit body (WORKER-PROMPT.md): a trailer survives a
 * squash or reword that an author identity would not, and needs no git
 * config most of this repo's commits don't set. A future commit-producing
 * stage (the release PR itself, once it exists) should stamp this trailer;
 * a caller with a different convention already in place can pass its own
 * predicate via `ReleaseRangeOptions.isMachineryCommit` instead of adopting
 * this one.
 */
const MACHINERY_TRAILER = /^machinery-commit:\s*true\s*$/im;

export function isMachineryCommit(commit: ReleaseRangeCommit): boolean {
  return MACHINERY_TRAILER.test(commit.body);
}

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

export interface ReleaseRangeOptions {
  /** The injected git executor. Never invoked against the working tree. */
  git: GitExec;
  /** The repo to read, threaded as `-C <repoDir>` (see `git.ts`) — never baked into `git`'s closure. */
  repoDir: string;
  /** The commit already covered by a prior release (exclusive). Omit to scope from the repo's root. */
  base?: string;
  /** The last commit in scope for this release. */
  head: string;
  /** Defaults to `isMachineryCommit` above. Inject a caller's own convention in its place. */
  isMachineryCommit?: (commit: ReleaseRangeCommit) => boolean;
}

/** The commit range a release covers, as `releaseCommitRange` hands it back. */
export interface ReleaseRange {
  base: string | undefined;
  head: string;
  /** `base..head`, oldest first, with every commit `isMachineryCommit` flagged removed. */
  commits: string[];
}

/**
 * Reads `base..head` via one `GitExec` log call and returns it with the
 * machinery's own commits excluded — spec #36 §Solution: "Exclude the
 * machinery's own commits from scope," the filter ADR-0029 measured the
 * absence of (63% → 82% machinery share of file touches, 20 of 92 commits in
 * one batch being the harness's own `ratify` verdicts). Mirrors
 * `readObservations`'s own range convention (`base` exclusive, omitted to
 * read from the repo's root) so the two seams compose without a caller
 * reconciling two different range shapes.
 */
export function releaseCommitRange(options: ReleaseRangeOptions): ReleaseRange {
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
    const commit: ReleaseRangeCommit = {
      sha: record.slice(0, first).trim(),
      author: record.slice(first + 1, second),
      subject: record.slice(second + 1, third),
      body: record.slice(third + 1).trim(),
    };

    if (!isMachinery(commit)) commits.push(commit.sha);
  }

  return { base, head, commits };
}

export interface ReleaseScopeOptions {
  /** The injected git executor, threaded to both the notes read and the commit-log read. */
  git: GitExec;
  /** The repo the notes and the commit log both live in. */
  repoDir: string;
  /** The commit already covered by a prior release (exclusive). Omit to scope from the repo's root. */
  base?: string;
  /** The last commit in scope for this run. */
  head: string;
  /** True when this run was handed a PRD-close event. */
  prdClosed: boolean;
  /** Overridable per `DEFAULT_RELEASE_THRESHOLD`'s own doc. Defaults to 20. */
  threshold?: number;
  /** Forwarded to `releaseCommitRange` — see its own doc. */
  isMachineryCommit?: (commit: ReleaseRangeCommit) => boolean;
}

/** What one release-scope evaluation hands back. */
export interface ReleaseScope {
  shouldRelease: boolean;
  /** How many observations in `base..head` have cleared the two-site gate. */
  releasedCount: number;
  /** Present only when `shouldRelease` is true — computing it costs a second git-log read, spent only when it will be used. */
  range?: ReleaseRange;
}

/**
 * The release-scope helper's entrypoint (spec #36 slice 5): reads
 * `refs/notes/observations` for `base..head` (`readObservations`, slice 4's
 * storage), counts what has cleared the two-site gate
 * (`countReleasedObservations`), decides whether a release should fire
 * (`evaluateReleaseTrigger` — a PRD close handed in via `prdClosed`, or the
 * count crossing `threshold`, whichever comes first), and — only when it
 * fires — computes the commit range to release with the machinery's own
 * commits excluded (`releaseCommitRange`). What a release then *does* with
 * that range (opening the PR, the exhaust filter, ratification memory) is a
 * later ticket's job; this function only decides and scopes.
 */
export function computeReleaseScope(options: ReleaseScopeOptions): ReleaseScope {
  const { git, repoDir, base, head, prdClosed, threshold, isMachineryCommit: isMachinery } = options;

  const unreleased = readObservations({ git, repoDir, base, head });
  const releasedCount = countReleasedObservations(unreleased.flatMap((entry) => entry.observations));
  const { shouldRelease } = evaluateReleaseTrigger({ releasedCount, prdClosed, threshold });

  if (!shouldRelease) return { shouldRelease, releasedCount };

  const range = releaseCommitRange({ git, repoDir, base, head, isMachineryCommit: isMachinery });
  return { shouldRelease, releasedCount, range };
}
