import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import type { Observation } from "./observation-schema";
import { readObservations } from "./notes";
import { filterByRatificationMemory, readRatificationRecords } from "./ratification";
import { composeRelease } from "./release";
import type { ReleaseBatch } from "./release-batch-schema";
import { computeReleaseScope, type ReleaseRangeCommit } from "./release-scope";

/**
 * The plain ref recording the head of the last release this pipeline
 * opened — spec #63 §Solution move 4's "piece #36 left unnamed," read here
 * as `computeReleaseScope`'s `base` and advanced once a release PR opens.
 * Absent before the first release, which `computeReleaseScope` already
 * treats as "scope from the repo root" (its own `base?` doc) — this module
 * leans on that existing meaning rather than inventing a second one.
 *
 * A **plain** ref, not a notes ref: `refs/notes/observations` and
 * `refs/notes/ratifications` each hold one fact *per commit*, addressed by
 * `git log --notes`. This ref holds one fact about the *pipeline's own
 * state* — where the last release stopped — with no commit to key it to
 * other than the value it points at, so it does not belong under
 * `refs/notes/` at all. No prior art in this tree names such a ref; the
 * path is this ticket's call, chosen to read as "the release lane's own
 * bookmark" rather than collide with a branch under `refs/heads/`.
 */
export const LAST_RELEASE_REF = "refs/release/last";

/**
 * Opens the hidden marker `renderChecklistItem` appends to every prose
 * checklist item — an HTML comment, which every Markdown renderer (GitHub's
 * included) drops from the rendered view but leaves intact in the raw PR
 * body text. That is what "hidden" buys: the owner reacts to the readable
 * half of the line, and a later reader — the workflow spec #63 §Solution
 * names next ("parses its checklist ... writes `RatificationRecord`s") —
 * recovers the exact `finding` and `sites` the checkbox decided about
 * straight from the merged PR, with no fuzzy re-matching against a finding's
 * prose.
 */
const MARKER_PREFIX = "<!-- release-finding:";
const MARKER_SUFFIX = "-->";

/** What one checklist item's hidden marker carries — see `MARKER_PREFIX`. */
export interface FindingMarker {
  finding: string;
  sites: string[];
}

function encodeFindingMarker(observation: Observation): string {
  const payload: FindingMarker = { finding: observation.finding, sites: observation.sites };
  return `${MARKER_PREFIX}${JSON.stringify(payload)}${MARKER_SUFFIX}`;
}

/**
 * Recovers a checklist item's `FindingMarker`, the inverse of
 * `encodeFindingMarker`. This module never calls it — it exists for the
 * later reader `MARKER_PREFIX`'s doc names, which parses a *merged PR's*
 * checklist rather than this run's own `Observation[]`. Returns `null` for
 * a line carrying no marker, or one that failed to parse as one, rather
 * than throwing: a hand-edited checklist line is not this function's
 * problem to raise, only to decline to trust.
 */
export function parseFindingMarker(checklistItem: string): FindingMarker | null {
  const start = checklistItem.indexOf(MARKER_PREFIX);
  if (start === -1) return null;
  const end = checklistItem.indexOf(MARKER_SUFFIX, start + MARKER_PREFIX.length);
  if (end === -1) return null;

  try {
    const parsed: unknown = JSON.parse(checklistItem.slice(start + MARKER_PREFIX.length, end));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { finding?: unknown }).finding === "string" &&
      Array.isArray((parsed as { sites?: unknown }).sites) &&
      (parsed as { sites: unknown[] }).sites.every((site) => typeof site === "string")
    ) {
      return parsed as FindingMarker;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * One prose finding's checklist line: the finding's own text and site list
 * for the owner to react to, followed by the hidden marker a later reader
 * parses back out. The readable half deliberately restates `sites` in
 * prose — spec #63 user story 28, "each prose finding... naming its
 * sites" — even though the marker also carries them, because the marker is
 * invisible in the rendered PR and the owner is the audience for the rest
 * of the line.
 */
function renderChecklistItem(observation: Observation): string {
  const sites = observation.sites.join(", ");
  return `${observation.finding} (\`${sites}\`) ${encodeFindingMarker(observation)}`;
}

function readLastReleaseRef(git: GitExec, repoDir: string): string | undefined {
  try {
    const output = git(["-C", repoDir, "rev-parse", "--verify", "--quiet", LAST_RELEASE_REF]);
    const head = output.trim();
    return head || undefined;
  } catch {
    return undefined;
  }
}

function advanceLastReleaseRef(git: GitExec, repoDir: string, head: string): void {
  git(["-C", repoDir, "update-ref", LAST_RELEASE_REF, head]);
}

/**
 * Creates and pushes this release's own head branch (#219): a release has no
 * diff of its own to carry — the mechanised half is still hard-coded empty
 * below, spec #63 defers it — so a branch pointing straight at `head` would
 * have no commits beyond what `base` already has, and `gh pr create` refuses
 * a head with nothing to show against its base. An empty commit is what
 * makes the branch openable without inventing content this lane isn't
 * ratifying.
 *
 * Built with plumbing (`commit-tree` + a pushed ref), not `checkout`/
 * `commit`: this repo's own working tree and `HEAD` are not this branch's —
 * `runRelease` may be called against the very checkout it is about to keep
 * running other commands in (the production entrypoint's `repoDir` is
 * `process.cwd()`), and moving `HEAD` out from under a caller is a
 * side-effect nothing here asked for.
 */
function createReleaseBranch(git: GitExec, repoDir: string, head: string): string {
  const name = `release/${head.slice(0, 12)}`;
  const tree = git(["-C", repoDir, "rev-parse", `${head}^{tree}`]).trim();
  const commit = git([
    "-C",
    repoDir,
    "commit-tree",
    tree,
    "-p",
    head,
    "-m",
    "Release: observations from this batch",
  ]).trim();
  git(["-C", repoDir, "push", "origin", `${commit}:refs/heads/${name}`]);
  return name;
}

/**
 * The release-eligible observations as of `head`: the most recent
 * observation note in `base..head`, filtered to what has cleared the
 * two-site gate (`Observation.released`).
 *
 * Deliberately *not* every note's observations flattened across the range —
 * each note `run-observations.ts` writes is already the full cumulative
 * state at that commit (prior findings folded in, per its own
 * `loadPriorFindings`), so a second, later note in the same range already
 * contains everything an earlier one does. Reading only the nearest one is
 * the same convention `loadPriorFindings` itself uses for the state going
 * *into* a run; this is the same state coming *out* of the range.
 */
function releaseEligibleObservations(options: { git: GitExec; repoDir: string; base?: string; head: string }): Observation[] {
  const { git, repoDir, base, head } = options;
  const [nearest] = readObservations({ git, repoDir, base, head });
  return (nearest?.observations ?? []).filter((observation) => observation.released);
}

export interface RunReleaseOptions {
  /** Threaded to the scope read, the observations/ratifications reads, and the last-release ref. */
  git: GitExec;
  /** Threaded to `composeRelease` — the only seam this module writes GitHub through. */
  gh: GhExec;
  /** The repo the notes, the commit log and the last-release ref all live in. */
  repoDir: string;
  /** The last commit in scope for this run — also where the last-release ref lands if a PR opens. */
  head: string;
  /** True when this run was handed a PRD-close event. Forwarded to `computeReleaseScope`. */
  prdClosed: boolean;
  /** Forwarded to `computeReleaseScope`. Defaults to its own `DEFAULT_RELEASE_THRESHOLD`. */
  threshold?: number;
  /** Forwarded to `computeReleaseScope`'s commit-range read. */
  isMachineryCommit?: (commit: ReleaseRangeCommit) => boolean;
  /** The branch the release PR merges into, forwarded to `composeRelease`. Omit for `gh`'s own default. */
  prBase?: string;
}

/** What one `runRelease` call hands back. */
export interface RunReleaseResult {
  /** `false` when the trigger didn't fire, or fired but nothing survived ratification memory. */
  opened: boolean;
  /** How many observations in scope cleared the two-site gate — `computeReleaseScope`'s own count, reported whether or not a release opened (spec #63 user story 21). */
  releasedCount: number;
  /** `composeRelease`'s own stdout (the new PR's URL). Present only when `opened` is true. */
  output?: string;
}

/**
 * The release module's own entrypoint (spec #63 §Solution move 4/5): reads
 * where the last release stopped (`LAST_RELEASE_REF`, absent scopes from
 * the repo root), asks `computeReleaseScope` whether this run should
 * release and what it covers, reads that scope's release-eligible
 * observations, drops whatever ratification memory says stays declined
 * (`filterByRatificationMemory`), renders a prose-only `ReleaseBatch` (the
 * mechanised half is always empty — spec #63 is explicit that the
 * mechanised half is a later spec) and, only once that batch is non-empty,
 * creates and pushes this release's own head branch (`createReleaseBranch`,
 * #219 — a prose-only release has no upstream branch to point `head` at,
 * unlike the mechanised half's applied-diff branch) before handing the
 * batch to `composeRelease` exactly once with that branch as `head`. An
 * empty batch returns early without creating a branch or calling
 * `composeRelease` at all, so an empty release still costs nothing beyond
 * the reads above and leaves the ref untouched. Only a successful open
 * (`opened: true`) moves `LAST_RELEASE_REF` to `head`.
 */
export function runRelease(options: RunReleaseOptions): RunReleaseResult {
  const { git, gh, repoDir, head, prdClosed, threshold, isMachineryCommit, prBase } = options;

  const base = readLastReleaseRef(git, repoDir);
  const scope = computeReleaseScope({ git, repoDir, base, head, prdClosed, threshold, isMachineryCommit });

  if (!scope.shouldRelease) {
    return { opened: false, releasedCount: scope.releasedCount };
  }

  const eligible = releaseEligibleObservations({ git, repoDir, base, head });
  const priorRatifications = readRatificationRecords({ git, repoDir, head });
  const surviving = filterByRatificationMemory({ observations: eligible, priorRatifications });

  const batch: ReleaseBatch = {
    mechanised: [],
    prose: surviving.map((observation) => ({ observation, checklistItem: renderChecklistItem(observation) })),
  };

  if (batch.mechanised.length === 0 && batch.prose.length === 0) {
    return { opened: false, releasedCount: scope.releasedCount };
  }

  const releaseHead = createReleaseBranch(git, repoDir, head);
  const result = composeRelease({ gh, batch, base: prBase, head: releaseHead });

  if (result.opened) {
    advanceLastReleaseRef(git, repoDir, head);
  }

  return { opened: result.opened, releasedCount: scope.releasedCount, output: result.output };
}
