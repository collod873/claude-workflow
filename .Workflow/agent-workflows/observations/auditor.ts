import type { GitExec } from "../shared/git";
import type { StageExec } from "../shared/stage";
import { sessionRangeDiff } from "./diff";
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
 * The auditor: scopes one session's diff via `sessionRangeDiff`, builds the
 * VIOLATION lens's prompt from it plus the session's spine and the ratified
 * standards, and spawns the sandboxed `claude -p` call through the injected
 * `exec` — the only lens this runs; PROPOSED is a separate pass, not built
 * here. Returns the sandboxed call's raw stdout unparsed: extracting
 * findings out of it is the release trigger's job (spec #36 slice 5), not
 * the auditor's.
 */
export function runAuditor(options: AuditorOptions): string {
  const { git, exec, repoDir, base, head, touchedPaths, spine, standards } = options;
  const diff = sessionRangeDiff({ git, repoDir, base, head, touchedPaths });
  const prompt = violationPrompt({ standards, diff, spine });
  return exec(["-p", prompt, ...SANDBOX_FLAGS]);
}
