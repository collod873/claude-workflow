#!/usr/bin/env node
/**
 * session-capture-hook.mjs — SessionEnd capture hook core (#44; part of #36). Invoked by
 * session-capture.sh as a fully detached, disowned child (stdio on /dev/null) — everything past
 * the handoff runs here, long after SessionEnd has already returned, so the run log
 * (`SESSION_CAPTURE_LOG_PATH`) is the only channel this has (mirrors Lumaria's #556: a missing
 * `node`, an empty transcript path and a healthy quiet session must never produce the same
 * evidence — an empty output).
 *
 * Argv: `<transcriptPath> <sessionId> <project> <source>` — session-capture.sh has already
 * confirmed `transcriptPath` is non-empty and exists before spawning this. `project` is
 * session-capture.sh's own name for the hook payload's `cwd` field (see that script's own
 * `PARSED` line) — it is reused below, unrenamed, as the session's own working directory for the
 * publish step's scope check.
 *
 * Storage: `${SESSION_CAPTURE_OUTPUT_DIR}/<YYYY-MM-DD>-<sessionId[:8]>.md`, atomically written —
 * a lockfile (exclusive create, the same primitive Lumaria's decision-capture-core.mjs uses),
 * then a tmp file next to the target, then `rename` into place. The lock's job here is narrower
 * than appendInboxEntry's: this hook never appends, it only ever creates one file per session, so
 * there is no read-decide-write race to serialize — the lock exists so two sessions that could
 * somehow race the exact same output path (a resumed/duplicated session id) don't interleave
 * their writes, and `rename` is what makes the write itself atomic regardless.
 *
 * Failure mode: FAIL OPEN throughout. Every step below is wrapped so a missing/unreadable
 * transcript, a broken extraction, or an unwritable output directory all degrade to "log a
 * `skipped <reason>` line and do nothing" — never a thrown error, since nothing is listening for
 * one (this process's stdio is /dev/null and nobody awaits it).
 *
 * A second half (spec #63 §Solution 1–2) runs after the corpus write, unconditionally attempted
 * but never a condition of it: derive the session's own commit range, write a `SessionRecord` git
 * note on `refs/notes/sessions`, push it, then fire the `repository_dispatch` that starts the
 * audit. It runs only when the session's own `cwd` resolves to this repo's own `origin` remote
 * (`repo-scope.ts`'s `sessionIsInThisRepo` — ADR-0018's split enforced in code) and is exactly as
 * fail-open as the corpus write above it: every one of its steps degrades to its own
 * `skipped publish-*` log line rather than a thrown error. See `repo-scope.ts` and `range.ts` for
 * why "no derivable range" means "publish nothing" here rather than a fallback.
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCaptureMarkdown, parseTranscript } from "../../.Workflow/agent-workflows/shared/spine.ts";
import { reason } from "../../.Workflow/agent-workflows/shared/reason.ts";
import { execGit } from "../../.Workflow/agent-workflows/shared/git.ts";
import { execGh } from "../../.Workflow/agent-workflows/shared/gh.ts";
import { deriveRange } from "../../.Workflow/agent-workflows/capture/range.ts";
import { ownerAndRepoFromOrigin, sessionIsInThisRepo } from "../../.Workflow/agent-workflows/capture/repo-scope.ts";
import { writeSessionRecord } from "../../.Workflow/agent-workflows/observations/session-notes.ts";
import { syncNotesRef } from "../../.Workflow/agent-workflows/shared/notes-sync.ts";

const OUTPUT_DIR = process.env.SESSION_CAPTURE_OUTPUT_DIR || join(homedir(), "Claude Projects", "Knowledge-Base", "raw", "sessions");
const LOG_PATH = process.env.SESSION_CAPTURE_LOG_PATH || join(homedir(), ".claude", "session-capture.log");
// This pipeline's own checkout — what the publish step reads and writes. Defaults to the repo
// this module itself lives in (three levels up from `.claude/hooks/`), the same computation
// session-capture.sh's own `repo_root` makes; overridable so a test can point the publish step at
// a throwaway fixture repo instead of ever touching this real checkout's own `origin`.
const REPO_DIR = process.env.SESSION_CAPTURE_REPO_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The `repository_dispatch` event type this fires. This is the name on the wire, and it is the
// one every consumer scopes on: `audit.yml`/`run-audit.ts` and `close-gate-reconcile.yml`/
// `reconcile.ts` each carry their own copy of the string, because no compiler sees from here into
// a workflow's `if`. `dispatch-action.test.ts` reads this line and asserts all four agree with it
// — the guard #107 was missing, when the audit side spent 14 runs waiting on a name nothing sent.
// Consumers move to this spelling; this one does not move to theirs.
const DISPATCH_EVENT_TYPE = "session-captured";

// A lock older than this is presumed abandoned (its holder crashed) rather than held — the same
// threshold and reasoning as Lumaria's decision-capture-core.mjs `withLock`.
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 25;

/** Same one-line-per-run shape as session-capture.sh's `log_outcome` — see that file's header. */
function log(outcome) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    appendFileSync(LOG_PATH, `${ts}\t${outcome}\n`);
  } catch {
    // Observability only — never let a log-write failure change what this hook does.
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Exclusive-create lockfile beside `path`, held for the duration of `fn`. Throws on failure. */
function withLock(path, fn) {
  const lockPath = `${path}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) unlinkSync(lockPath);
      } catch {
        // Lost the race to reclaim it, or it's already gone — loop around and retry the acquire.
      }
      if (Date.now() - start > LOCK_TIMEOUT_MS) throw new Error("lock-timeout");
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone — nothing left to release.
    }
  }
}

/** tmp file + lock + rename — see the module header for why the lock is narrow here. */
function atomicWrite(targetPath, content) {
  withLock(targetPath, () => {
    const tmpPath = `${targetPath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, targetPath);
  });
}

/**
 * The transcript's own `[since, until]` window `deriveRange` wants: the first and last valid
 * `timestamp` field found across the transcript's lines, in transcript order — the same field
 * `backfill.ts`'s `lastTimestamp` reads, kept here rather than imported since that helper only
 * ever needed the last one. A line that fails to parse, or carries no usable timestamp, is
 * skipped rather than treated as a defect, matching `parseTranscript`'s own tolerance.
 */
function transcriptWindow(jsonl) {
  let since;
  let until;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = entry?.timestamp;
    if (typeof ts !== "string" || Number.isNaN(Date.parse(ts))) continue;
    if (since === undefined) since = ts;
    until = ts;
  }
  return { since, until };
}

/**
 * Fires the `repository_dispatch` that starts the audit — the connector (spec #63 §Solution 2).
 * Carries no payload beyond `head`; everything else the audit needs is already in the note this
 * is called after pushing. Resolves `repos/{owner}/{repo}` itself from `repoDir`'s own `origin`
 * rather than leaning on `gh`'s cwd-resolved `{owner}/{repo}` placeholder (`GhExec`'s own note):
 * this process's actual OS cwd is whatever launched session-capture.sh, not reliably `repoDir`.
 */
function dispatchAudit(repoDir, head) {
  const origin = execGit(["-C", repoDir, "remote", "get-url", "origin"]).trim();
  const ownerRepo = ownerAndRepoFromOrigin(origin);
  if (!ownerRepo) throw new Error(`cannot parse owner/repo from origin: ${origin}`);
  execGh([
    "api",
    `repos/${ownerRepo.owner}/${ownerRepo.repo}/dispatches`,
    "-f",
    `event_type=${DISPATCH_EVENT_TYPE}`,
    "-f",
    `client_payload[head]=${head}`,
  ]);
}

/**
 * The hook's second half (module header, spec #63 §Solution 1–2): derive the session's own range,
 * publish its `SessionRecord`, dispatch the audit. Every step is its own `skipped publish-*` log
 * line on failure — see the module header for why this is a *different* failure posture from the
 * corpus write above it, never a thrown error either way.
 */
function publishSessionRecord({ sessionId, sessionCwd, jsonl, markdown, parsed }) {
  if (!sessionIsInThisRepo({ git: execGit, sessionCwd, repoDir: REPO_DIR })) {
    log("skipped publish-out-of-scope");
    return;
  }

  const { since, until } = transcriptWindow(jsonl);
  if (!since || !until) {
    log("skipped publish-no-window");
    return;
  }

  let range;
  try {
    range = deriveRange({ git: execGit, repoDir: REPO_DIR, since, until });
  } catch (err) {
    log(`skipped publish-range-failed: ${reason(err)}`);
    return;
  }
  if (!range) {
    log("skipped publish-no-range");
    return;
  }

  const touchedPaths = [...parsed.filesEdited, ...parsed.filesWritten];
  const record = { sessionId, base: range.base, head: range.head, touchedPaths, spine: markdown };

  try {
    syncNotesRef({
      git: execGit,
      repoDir: REPO_DIR,
      ref: "sessions",
      apply: () => writeSessionRecord({ git: execGit, repoDir: REPO_DIR, record }),
    });
  } catch (err) {
    log(`skipped publish-push-failed: ${reason(err)}`);
    return;
  }

  try {
    dispatchAudit(REPO_DIR, range.head);
  } catch (err) {
    log(`skipped publish-dispatch-failed: ${reason(err)}`);
    return;
  }

  log(`published ${sessionId} ${range.head}`);
}

function main() {
  const [, , transcriptPath, sessionIdArg, projectArg, sourceArg] = process.argv;
  const sessionId = sessionIdArg || "unknown";
  const sessionCwd = projectArg || "unknown";

  if (!transcriptPath) {
    log("skipped no-transcript-path");
    return;
  }

  let jsonl;
  try {
    jsonl = readFileSync(transcriptPath, "utf8");
  } catch (err) {
    log(`skipped transcript-unreadable: ${reason(err)}`);
    return;
  }

  let parsed;
  let markdown;
  try {
    parsed = parseTranscript(jsonl);
    markdown = buildCaptureMarkdown(
      { sessionId, project: sessionCwd, date: new Date().toISOString(), source: sourceArg || "other" },
      parsed,
    );
  } catch (err) {
    log(`skipped extraction-failed: ${reason(err)}`);
    return;
  }

  const datePrefix = new Date().toISOString().slice(0, 10);
  const outPath = join(OUTPUT_DIR, `${datePrefix}-${sessionId.slice(0, 8)}.md`);

  try {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    atomicWrite(outPath, markdown);
  } catch (err) {
    log(`skipped write-failed: ${reason(err)}`);
    return;
  }

  log(`captured ${sessionId}`);

  // The corpus write above is never conditional on this succeeding — see the module header.
  try {
    publishSessionRecord({ sessionId, sessionCwd, jsonl, markdown, parsed });
  } catch (err) {
    log(`skipped publish-failed: ${reason(err)}`);
  }
}

// Only run as a CLI when invoked directly (`node session-capture-hook.mjs ...`, what
// session-capture.sh does) — importing this module must never trigger a live write as a side
// effect of import. `fileURLToPath` decodes this module's own URL back to a plain path rather
// than the reverse (a hand-built `file://` from argv), which is the direction that survives a
// path containing spaces — see decision-capture.mjs, the same guard this one is copied from.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    // Fail open — see module header. Nothing above should throw uncaught, but this is the
    // backstop: a run that dies here still leaves one line of evidence behind.
    log(`skipped unexpected: ${reason(err)}`);
  }
}
