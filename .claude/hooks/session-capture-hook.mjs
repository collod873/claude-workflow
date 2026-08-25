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
 * confirmed `transcriptPath` is non-empty and exists before spawning this.
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
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractSpine } from "../../.Workflow/agent-workflows/shared/spine.ts";
import { reason } from "../../.Workflow/agent-workflows/shared/reason.ts";

const OUTPUT_DIR = process.env.SESSION_CAPTURE_OUTPUT_DIR || join(homedir(), "Claude Projects", "Knowledge-Base", "raw", "sessions");
const LOG_PATH = process.env.SESSION_CAPTURE_LOG_PATH || join(homedir(), ".claude", "session-capture.log");

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

function main() {
  const [, , transcriptPath, sessionIdArg, projectArg, sourceArg] = process.argv;
  const sessionId = sessionIdArg || "unknown";

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

  let markdown;
  try {
    markdown = extractSpine(jsonl, {
      sessionId,
      project: projectArg || "unknown",
      date: new Date().toISOString(),
      source: sourceArg || "other",
    });
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
