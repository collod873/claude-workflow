import type { GitExec } from "../shared/git";
import type { StageExec } from "../shared/stage";
import { sessionRangeDiff } from "./diff";
import { applyTwoSiteGate, parseProposedFindings, proposedPrompt, type GatedProposedFinding } from "./lenses/proposed";
import { violationPrompt } from "./lenses/violation";

/**
 * Inputs to `runAuditor`. `spine` and `standards` are handed in as text, not
 * read from disk here: the auditor scopes a diff and runs a lens over it, it
 * doesn't source the lens's inputs — capture owns the spine's shape (spec
 * #36 slice 1) and the caller owns which `CODING_STANDARDS.md` to check
 * against.
 */
export interface AuditorOptions {
  /** The injected git executor `sessionRangeDiff` runs against. */
  git: GitExec;
  /** The injected executor the sandboxed `claude -p` call runs through. */
  exec: StageExec;
  /** The repo the session's range diff is computed against, threaded as `-C <repoDir>` (see `sessionRangeDiff`). */
  repoDir: string;
  /** The commit the session's range starts after (exclusive) — the diff is `base..head`. */
  base: string;
  /** The last commit in the session's own range. */
  head: string;
  /** Paths the transcript shows this session touching — see `sessionRangeDiff` for why an empty list restricts nothing. */
  touchedPaths?: string[];
  /** The session's captured conversation spine (capture's own format, spec #36 slice 1). */
  spine: string;
  /** Ratified `CODING_STANDARDS.md` text the VIOLATION lens checks the diff against. */
  standards: string;
}

/**
 * Flags for the sandboxed `claude -p` call the VIOLATION lens runs through
 * (spec #36 slice 3, `-p <prompt>` prepended below), ported verbatim from
 * Lumaria's `decision-capture.mjs` — do not re-derive. `--tools ""` is
 * load-bearing: settings-derived allow rules merge across scopes, so without
 * it a global permissive allowlist would otherwise apply to this call. The
 * hook that eventually consumes a finding owns the only write; this call
 * never does.
 */
const SANDBOX_FLAGS = [
  "--model",
  "sonnet",
  "--output-format",
  "text",
  "--no-session-persistence",
  "--tools",
  "",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--setting-sources",
  "",
];

/**
 * The auditor's VIOLATION pass: scopes one session's diff via
 * `sessionRangeDiff`, builds the VIOLATION lens's prompt from it plus the
 * session's spine and the ratified standards, and spawns the sandboxed
 * `claude -p` call through the injected `exec`. PROPOSED is a separate pass
 * — `runProposedAuditor` below — with its own findings shape, so it isn't
 * folded into this call or this return type. Returns the sandboxed call's
 * raw stdout unparsed: extracting findings out of it is the release
 * trigger's job (spec #36 slice 5), not the auditor's.
 */
export async function runAuditor(options: AuditorOptions): Promise<string> {
  const { git, exec, repoDir, base, head, touchedPaths, spine, standards } = options;
  const diff = sessionRangeDiff({ git, repoDir, base, head, touchedPaths });
  const prompt = violationPrompt({ standards, diff, spine });
  return exec(["-p", prompt, ...SANDBOX_FLAGS]);
}

/**
 * Inputs to `runProposedAuditor`. No `standards` — PROPOSED doesn't check
 * the diff against `CODING_STANDARDS.md`, it looks for a pattern worth a
 * new entry (`lenses/proposed.ts`).
 */
export interface ProposedAuditorOptions {
  /** The injected git executor `sessionRangeDiff` runs against. */
  git: GitExec;
  /** The injected executor the sandboxed `claude -p` call runs through — same seam, same flags, as VIOLATION's. */
  exec: StageExec;
  /** The repo the session's range diff is computed against, threaded as `-C <repoDir>` (see `sessionRangeDiff`). */
  repoDir: string;
  /** The commit the session's range starts after (exclusive) — the diff is `base..head`. */
  base: string;
  /** The last commit in the session's own range. */
  head: string;
  /** Paths the transcript shows this session touching — see `sessionRangeDiff` for why an empty list restricts nothing. */
  touchedPaths?: string[];
  /** The session's captured conversation spine (capture's own format, spec #36 slice 1). */
  spine: string;
  /**
   * Gated findings the two-site gate has already recorded across prior
   * runs — its memory. Defaults to none. Persisting this across runs (git
   * notes) is a later slice's job; this call only merges what it's handed.
   */
  priorFindings?: GatedProposedFinding[];
}

/**
 * The auditor's PROPOSED pass: reuses `sessionRangeDiff` (slice 3) and the
 * same sandboxed `claude -p` flags VIOLATION uses (`SANDBOX_FLAGS`,
 * unchanged) to run the PROPOSED lens, then parses its raw text into
 * `ProposedFinding`s and folds them into `priorFindings` through the
 * two-site gate. Unlike `runAuditor`, this returns structured, gated
 * findings rather than raw stdout — the two-site gate has to compare a
 * finding's identity across runs, so PROPOSED can't defer parsing to the
 * release trigger the way VIOLATION does.
 */
export async function runProposedAuditor(
  options: ProposedAuditorOptions,
): Promise<GatedProposedFinding[]> {
  const { git, exec, repoDir, base, head, touchedPaths, spine, priorFindings = [] } = options;
  const diff = sessionRangeDiff({ git, repoDir, base, head, touchedPaths });
  const prompt = proposedPrompt({ diff, spine });
  const raw = await exec(["-p", prompt, ...SANDBOX_FLAGS]);
  const findings = parseProposedFindings(raw);
  return applyTwoSiteGate(priorFindings, findings);
}
