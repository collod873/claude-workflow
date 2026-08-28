import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { syncNotesRef } from "../shared/notes-sync";
import { execClaude, type StageExec } from "../shared/stage";
import { repoScoped } from "../capture/touched-paths";
import { writeObservationNote } from "./notes";
import { runObservations } from "./run-observations";
import { runRelease } from "./run-release";
import { readSessionRecord, type HydratedSessionRecord } from "./session-notes";

/**
 * The connector spec #63 names as still missing: the piece
 * that actually fires `runObservations` and `runRelease` on a real session,
 * at the one venue ADR-0002 allows (`.github/workflows/audit.yml`, this
 * module's own `main`).
 *
 * `.github/workflows/audit.yml` triggers broadly on `repository_dispatch` —
 * left unfiltered by `types:` on purpose, since a sibling workflow (spec #63's
 * release-on-PRD-close trigger) shares the same trigger surface with a
 * different `action` — so the job-level `if` is what actually scopes a run to
 * an audit dispatch. `AUDIT_DISPATCH_ACTION` is spelled there as well as
 * here, the same duplication `release-on-prd-close.ts`'s
 * `DELIVERY_CLOSE_REASON` is spelled in both that file and its own workflow:
 * no compiler sees across that language boundary, so `run-audit.test.ts` asserts the two
 * still agree, and this constant is the second reader for a local run and for
 * the case where the workflow's own `if` is ever edited wrong.
 *
 * The name is the emitter's, not this lane's (#107). This constant and
 * `audit.yml` both used to read `audit`, agreeing with each other and with
 * nothing on the wire: the hook has always dispatched `session-captured`, so
 * 14 of 14 `Audit` runs skipped while both sides stayed green. A consumer is
 * free to be renamed, an emitter with two live consumers is not, so the
 * consumers moved. `dispatch-action.test.ts` is the guard that now reads the
 * hook itself and refuses any consumer that drifts off it again.
 */
export const AUDIT_DISPATCH_ACTION = "session-captured";

/**
 * The Knowledge-Base checkout's own directory on the runner, relative to
 * `repoDir` — the second checkout `audit.yml` gains alongside this repo's
 * own, over a deploy key, so the auditor can hydrate a session's spine from
 * a private source rather than a public git note (spec #134 §"The runner
 * reads the corpus over a deploy key"). Named here as well as in
 * `audit.yml`'s own second `actions/checkout` step, the same duplication
 * `AUDIT_DISPATCH_ACTION` above already accepts across the language
 * boundary a compiler cannot see across.
 */
export const KNOWLEDGE_BASE_CHECKOUT_DIR = "knowledge-base";

export interface RunAuditOptions {
  git: GitExec;
  gh: GhExec;
  /** The injected executor the auditor's sandboxed `claude -p` calls run through. */
  exec: StageExec;
  /** The repo the session's notes, its commit range, and the release ref all live in. */
  repoDir: string;
  /** The session's own head commit — the note this run reads is keyed here, and the release scope ends here. */
  head: string;
  /** Ratified `CODING_STANDARDS.md` text, forwarded to `runObservations`'s VIOLATION lens. */
  standards: string;
  /** `github.event.action` on the dispatch that triggered this run — see `AUDIT_DISPATCH_ACTION`. */
  eventAction: string | null | undefined;
  /** The remote notes are fetched from and pushed to. Defaults to `"origin"`. */
  remote?: string;
  log?: (line: string) => void;
}

export type AuditAction = "skipped" | "ran";

export interface AuditOutcome {
  action: AuditAction;
  /** A stable slug, for the log — mirrors `run-watchdog.ts`'s `Outcome.code`. */
  code: string;
  /** `computeReleaseScope`'s own count, reported whether or not a release opened. `0` on every skip. */
  releasedCount: number;
}

/**
 * Fetches `refs/notes/sessions` and `refs/notes/observations` from `remote`
 * into `repoDir`'s local refs — read-only, unlike `notes-sync.ts`'s own
 * private `fetchNotesRef`, which exists to bring a local ref current
 * immediately before a push attempt on it. This one exists so
 * `readSessionRecord` sees a session record a capture run published
 * elsewhere, and so `runObservations`'s prior-findings fold-in
 * (`run-observations.ts`'s `loadPriorFindings`) has something to fold in —
 * a fresh Actions checkout starts with no notes refs at all. Skipped
 * entirely when the remote carries no such ref yet, the same first-publish
 * case `notes-sync.ts`'s version handles: fetching a ref that does not
 * exist is itself the failure `git fetch` would report.
 */
function fetchNotesRef(git: GitExec, repoDir: string, ref: string, remote: string): void {
  const remoteRef = git(["-C", repoDir, "ls-remote", remote, `refs/notes/${ref}`]);
  if (!remoteRef.trim()) return;
  git(["-C", repoDir, "fetch", remote, `+refs/notes/${ref}:refs/notes/${ref}`]);
}

/**
 * The audit pipeline's own entrypoint (spec #63 §Solution move 4, the
 * connector): reads the session record a capture run published at `head`,
 * skips with no model call when there is none or its range is empty (a
 * session that made no commit has no diff for either lens to read), runs
 * both lenses (`run-observations.ts`'s `runObservations`) over the rest,
 * pushes the merged note through `notes-sync.ts`'s fetch/apply/push-with-retry
 * helper, and evaluates this run's release scope with `prdClosed: false`
 * (`run-release.ts`'s `runRelease` — a PRD close fires through the sibling
 * release-on-PRD-close workflow instead, never through this one). Reports
 * the released count whether or not a release actually opened, matching
 * `RunReleaseResult`'s own convention.
 */
export async function runAudit(options: RunAuditOptions): Promise<AuditOutcome> {
  const { git, gh, exec, repoDir, head, standards, eventAction } = options;
  const remote = options.remote ?? "origin";
  const log = options.log ?? ((line: string) => console.log(line));

  if (eventAction !== AUDIT_DISPATCH_ACTION) {
    return { action: "skipped", code: "not-an-audit-dispatch", releasedCount: 0 };
  }

  fetchNotesRef(git, repoDir, "sessions", remote);
  fetchNotesRef(git, repoDir, "observations", remote);

  const corpusDir = join(repoDir, KNOWLEDGE_BASE_CHECKOUT_DIR);
  let record: HydratedSessionRecord | undefined;
  try {
    record = readSessionRecord({ git, repoDir, head, corpusDir });
  } catch (err) {
    log(`skipped: session record at ${head} has no readable corpus: ${reason(err)}`);
    return { action: "skipped", code: "corpus-missing", releasedCount: 0 };
  }
  if (!record) {
    log(`skipped: no session record at ${head}`);
    return { action: "skipped", code: "no-session-record", releasedCount: 0 };
  }
  if (record.base === record.head) {
    log(`skipped: session ${record.sessionId}'s range is empty at ${head}`);
    return { action: "skipped", code: "empty-range", releasedCount: 0 };
  }

  // Records written before `touched-paths.ts` existed carry absolute workstation paths, and a
  // note on `refs/notes/sessions` is never rewritten — so this run would inherit a pathspec that
  // makes `git diff` exit `fatal: Invalid path` on a runner (#107). What can't be repaired here is
  // dropped, and the lens reads the unrestricted range diff instead: wider than intended, which is
  // the version of wrong that still produces a finding. Said out loud so a wide read is never
  // mistaken for a narrow one.
  const touchedPaths = repoScoped(record.touchedPaths);
  if (touchedPaths.length !== record.touchedPaths.length) {
    const dropped = record.touchedPaths.length - touchedPaths.length;
    log(`note: dropped ${dropped} unusable path(s) from session ${record.sessionId}'s record`);
  }

  const observations = await runObservations({
    git,
    exec,
    repoDir,
    base: record.base,
    head: record.head,
    touchedPaths,
    spine: record.spine,
    standards,
  });

  syncNotesRef({
    git,
    repoDir,
    ref: "observations",
    remote,
    apply: () => writeObservationNote({ git, repoDir, commit: record.head, observations }),
  });

  const release = runRelease({ git, gh, repoDir, head: record.head, prdClosed: false });
  log(`audited: released ${release.releasedCount}`);

  return { action: "ran", code: "audited", releasedCount: release.releasedCount };
}

async function main(): Promise<void> {
  try {
    const head = process.env.HEAD_SHA;
    if (!head) {
      throw new Error("HEAD_SHA must be set");
    }
    // `GITHUB_WORKSPACE` is the checkout's own path, set by every Actions runner without this
    // workflow needing to name it in `env:` — falling back to `process.cwd()` is what lets a local
    // run (or a test driving this file as a real subprocess against a throwaway fixture repo) hand
    // in a different one without `tsx`'s own resolution needing to run from inside it too.
    const repoDir = process.env.GITHUB_WORKSPACE || process.cwd();
    const standards = readFileSync(join(repoDir, "CODING_STANDARDS.md"), "utf8");

    const outcome = await runAudit({
      git: execGit,
      gh: execGh,
      exec: execClaude,
      repoDir,
      head,
      standards,
      eventAction: process.env.EVENT_ACTION,
    });
    console.log(`${outcome.action} (${outcome.code}): released ${outcome.releasedCount}`);
  } catch (err) {
    console.error(`run-audit failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
