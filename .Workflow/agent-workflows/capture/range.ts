/**
 * range.ts — derives one session's own commit range from its transcript's own time window, ported
 * from Lumaria's `deriveRange` (commits `d4ab813`/`0ddfb09`, #719/#720 — the same pair
 * `observations/diff.ts`'s `touchedPaths` restriction was ported from) for spec #63's capture
 * half: "Capture records no SHA range" (#63 gap 3) is what this closes.
 *
 * The window is `git log --since/--until` over the transcript's own first and last entry
 * timestamps — not "when the script happens to run" (see `backfill.ts`'s own note on why "now" is
 * the wrong clock for anything but a live `SessionEnd`). Head is the newest commit the window
 * names; base is that window's oldest commit's own parent, so the eventual `base..head` diff
 * (`sessionRangeDiff`, `observations/diff.ts`) excludes the oldest commit's own history but
 * includes the oldest commit itself. A root commit has no parent to name, so base falls back to
 * git's well-known empty-tree object — diffing against it shows the root commit's entire content
 * as added, the same as diffing against a real empty parent would.
 *
 * Deliberate deviation from Lumaria's own behaviour (spec #63): Lumaria fails open here — an
 * unparseable window or a window naming no commits still yields *some* range, on the theory that a
 * degraded range beats none. This capture is upstream of an auditor that spends a model call per
 * run (#63's whole reason for existing), and a silently-widened range would feed that auditor a
 * diff nobody's transcript actually claims. So this returns no range at all in both cases —
 * `undefined`, never a fallback pair, and never the working tree — leaving "skip this session's
 * audit" to the caller rather than guessing a range for it.
 */
import type { GitExec } from "../shared/git.ts";

/** git's well-known empty-tree object — same in every repository, not this one's own. */
export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Inputs to `deriveRange`. */
export interface DeriveRangeOptions {
  /** The injected git executor — see `GitExec`'s own note on why this is never invoked directly. */
  git: GitExec;
  /** The repo to read, threaded through argv as `-C <repoDir>` (see `git.ts`) — never baked into `git`'s closure. */
  repoDir: string;
  /** The transcript's own first entry timestamp — `git log --since`. */
  since: string;
  /** The transcript's own last entry timestamp — `git log --until`. */
  until: string;
}

/** The `base..head` a session's range resolves to, or nothing at all — see the module header. */
export interface CommitRange {
  base: string;
  head: string;
}

/**
 * Derives one session's commit range from its transcript's own `[since, until]` window — see the
 * module header for the full shape and for why this returns `undefined` rather than any fallback
 * range when the window is unusable.
 */
export function deriveRange(options: DeriveRangeOptions): CommitRange | undefined {
  const { git, repoDir, since, until } = options;

  if (Number.isNaN(Date.parse(since)) || Number.isNaN(Date.parse(until))) return undefined;

  const log = git(["-C", repoDir, "log", `--since=${since}`, `--until=${until}`, "--format=%H"]);
  const shas = log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (shas.length === 0) return undefined;

  const head = shas[0]; // git log is newest-first by default.
  const oldest = shas[shas.length - 1];

  let base: string;
  try {
    base = git(["-C", repoDir, "rev-parse", `${oldest}^`]).trim();
  } catch {
    // `oldest` is a root commit — it has no parent to name. See the module header.
    base = EMPTY_TREE_HASH;
  }

  return { base, head };
}
