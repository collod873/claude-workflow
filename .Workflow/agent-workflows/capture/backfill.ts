/**
 * backfill.ts — walks a directory of historical Claude Code transcripts and writes one capture
 * file per transcript that doesn't already have one, reusing `spine.ts`'s `extractSpine` (#45;
 * part of #36's build order step 2, "Backfill what survives in `~/.claude/projects/`"). The same
 * function `.claude/hooks/session-capture-hook.mjs` (#44) calls at `SessionEnd` — one extraction,
 * two callers, so a live capture and a backfilled one are shaped identically.
 *
 * Source layout: `<sourceDir>/<project>/<sessionId>.jsonl` — the two-level layout
 * `~/.claude/projects/` itself uses (a project's encoded-cwd directory, holding one `.jsonl` per
 * session). `discoverTranscripts` reads exactly that shape; a fixture directory in tests mirrors
 * it rather than inventing a flatter one.
 *
 * Where the source directory comes from: a CLI arg (`argv[2]`), then
 * `SESSION_CAPTURE_TRANSCRIPTS_DIR`, then `~/.claude/projects` — never hard-coded, so a test can
 * always point this at a fixture directory and never at the real one. Output directory and log
 * path reuse the hook's own env vars (`SESSION_CAPTURE_OUTPUT_DIR`, `SESSION_CAPTURE_LOG_PATH`):
 * backfilled and live captures land in one store with one run log.
 *
 * Idempotency: a transcript is skipped, not re-captured, once any file in the output directory
 * already ends `-<sessionId[:8]>.md` — the same suffix both this script and the hook name their
 * output by. That is checked by suffix rather than by recomputing an exact path, so a session the
 * live hook already captured (on whatever date it actually ran) is recognised as captured here
 * too, even though this script derives its own date differently (see below).
 *
 * `date`: the hook uses "now" — the moment of capture, which for a live `SessionEnd` is also
 * approximately when the session happened. That equivalence doesn't hold for a backfill run
 * happening long after the fact, and "now" would also make the output filename (which embeds the
 * date) depend on which day the script happens to run — the opposite of idempotent. Instead this
 * derives `date` from the transcript's own last valid `timestamp` field, falling back to "now"
 * only when a transcript carries none at all.
 *
 * Not fail-open like the hook: this is an owner-run tool, not an unattended `SessionEnd` handler,
 * so a directory that can't be walked at all is a real usage error worth reporting loudly rather
 * than swallowing. A single transcript's own failure (unreadable file, extraction error, write
 * failure) is still caught and logged as `skipped <reason>` — one bad transcript must not stop the
 * rest of the run — matching the hook's per-run outcome shape exactly.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
  appendFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractSpine, type SpineMeta } from "../shared/spine";
import { reason } from "../shared/reason";

const DEFAULT_SOURCE_DIR = join(homedir(), ".claude", "projects");
const DEFAULT_OUTPUT_DIR = join(homedir(), "Claude Projects", "Knowledge-Base", "raw", "sessions");
const DEFAULT_LOG_PATH = join(homedir(), ".claude", "session-capture.log");

// Same lock/tmp-file/rename shape as session-capture-hook.mjs's `withLock` / `atomicWrite` (#44) —
// copied rather than re-derived, per that ticket's own instruction to build on it.
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 25;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Exclusive-create lockfile beside `path`, held for the duration of `fn`. Throws on failure. */
function withLock(path: string, fn: () => void): void {
  const lockPath = `${path}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
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
function atomicWrite(targetPath: string, content: string): void {
  withLock(targetPath, () => {
    const tmpPath = `${targetPath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, targetPath);
  });
}

/** Same one-line-per-run shape as the hook's own `log` — one timeline, one format. */
function log(logPath: string, outcome: string): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    appendFileSync(logPath, `${ts}\t${outcome}\n`);
  } catch {
    // Observability only — never let a log-write failure change what this run does.
  }
}

/** One transcript this script found under `sourceDir`, before it's read. */
export interface TranscriptRef {
  path: string;
  project: string;
  sessionId: string;
}

/**
 * Walks the `<sourceDir>/<project>/<sessionId>.jsonl` layout — see the module header. A
 * `sourceDir` entry that isn't a directory, or a project directory holding no `.jsonl` files, is
 * skipped rather than treated as a defect. Sorted by path for a deterministic run order.
 */
export function discoverTranscripts(sourceDir: string): TranscriptRef[] {
  const refs: TranscriptRef[] = [];
  const projectDirs = readdirSync(sourceDir, { withFileTypes: true }).filter((e) => e.isDirectory());

  for (const projectDir of projectDirs) {
    const projectPath = join(sourceDir, projectDir.name);
    const files = readdirSync(projectPath, { withFileTypes: true }).filter(
      (e) => e.isFile() && e.name.endsWith(".jsonl"),
    );
    for (const file of files) {
      refs.push({
        path: join(projectPath, file.name),
        project: projectDir.name,
        sessionId: basename(file.name, ".jsonl"),
      });
    }
  }

  return refs.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The last valid `timestamp` field found across a transcript's lines — the closest available
 * approximation of when the session actually ended, and (unlike "now") the same value every time
 * this transcript is read. A line that fails to parse, or carries no usable timestamp, is skipped
 * rather than treated as a defect — same tolerance `parseTranscript` (spine.ts) applies to a
 * transcript's other fields.
 */
export function lastTimestamp(jsonl: string): string | undefined {
  let last: string | undefined;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: { timestamp?: unknown };
    try {
      entry = JSON.parse(line) as { timestamp?: unknown };
    } catch {
      continue;
    }
    if (typeof entry.timestamp === "string" && !Number.isNaN(Date.parse(entry.timestamp))) {
      last = entry.timestamp;
    }
  }
  return last;
}

/** The `-<sessionId[:8]>.md` suffix every capture file — this script's or the hook's — is named by. */
function sessionSuffixesOf(files: string[]): Set<string> {
  const suffixes = new Set<string>();
  for (const file of files) {
    const match = /-([^-]+)\.md$/.exec(file);
    if (match) suffixes.add(match[1]);
  }
  return suffixes;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export interface BackfillOptions {
  sourceDir: string;
  outputDir: string;
  logPath: string;
}

export interface BackfillOutcome {
  sessionId: string;
  outcome: string;
}

/**
 * Runs the backfill end to end: discover, then for each transcript either skip (already captured)
 * or extract + atomically write + log `captured <sessionId>`. A per-transcript failure is caught,
 * logged as `skipped <reason>`, and does not stop the rest of the run. Throws only if `sourceDir`
 * itself can't be walked — see the module header for why that case is not swallowed.
 */
export function runBackfill(opts: BackfillOptions): BackfillOutcome[] {
  const { sourceDir, outputDir, logPath } = opts;
  const transcripts = discoverTranscripts(sourceDir);

  mkdirSync(outputDir, { recursive: true });
  const captured = sessionSuffixesOf(safeReaddir(outputDir));

  const results: BackfillOutcome[] = [];

  for (const transcript of transcripts) {
    const sid8 = transcript.sessionId.slice(0, 8);

    if (captured.has(sid8)) {
      const outcome = `skipped already-captured: ${transcript.sessionId}`;
      log(logPath, outcome);
      results.push({ sessionId: transcript.sessionId, outcome });
      continue;
    }

    let jsonl: string;
    try {
      jsonl = readFileSync(transcript.path, "utf8");
    } catch (err) {
      const outcome = `skipped transcript-unreadable: ${reason(err)}`;
      log(logPath, outcome);
      results.push({ sessionId: transcript.sessionId, outcome });
      continue;
    }

    let markdown: string;
    let date: string;
    try {
      date = lastTimestamp(jsonl) ?? new Date().toISOString();
      const meta: SpineMeta = { sessionId: transcript.sessionId, project: transcript.project, date, source: "backfill" };
      markdown = extractSpine(jsonl, meta);
    } catch (err) {
      const outcome = `skipped extraction-failed: ${reason(err)}`;
      log(logPath, outcome);
      results.push({ sessionId: transcript.sessionId, outcome });
      continue;
    }

    const outPath = join(outputDir, `${date.slice(0, 10)}-${sid8}.md`);
    try {
      atomicWrite(outPath, markdown);
    } catch (err) {
      const outcome = `skipped write-failed: ${reason(err)}`;
      log(logPath, outcome);
      results.push({ sessionId: transcript.sessionId, outcome });
      continue;
    }

    captured.add(sid8);
    const outcome = `captured ${transcript.sessionId}`;
    log(logPath, outcome);
    results.push({ sessionId: transcript.sessionId, outcome });
  }

  return results;
}

function resolveSourceDir(): string {
  return process.argv[2] || process.env.SESSION_CAPTURE_TRANSCRIPTS_DIR || DEFAULT_SOURCE_DIR;
}

function resolveOutputDir(): string {
  return process.env.SESSION_CAPTURE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
}

function resolveLogPath(): string {
  return process.env.SESSION_CAPTURE_LOG_PATH || DEFAULT_LOG_PATH;
}

function main(): void {
  const sourceDir = resolveSourceDir();
  if (!existsSync(sourceDir)) {
    throw new Error(`source directory does not exist: ${sourceDir}`);
  }

  const outcomes = runBackfill({ sourceDir, outputDir: resolveOutputDir(), logPath: resolveLogPath() });
  const capturedCount = outcomes.filter((o) => o.outcome.startsWith("captured ")).length;
  console.log(`backfill: ${capturedCount} captured, ${outcomes.length - capturedCount} skipped, ${outcomes.length} total`);
}

// Only run as a CLI when invoked directly (`npx tsx backfill.ts ...`), not when this module is
// imported for its exports (tests). Built through `pathToFileURL` rather than a hand-rolled
// `file://${...}` template — see WORKER-PROMPT.md #139 and to-tickets.ts's own guard, which this
// one copies: a raw template is not percent-encoded, so it silently never matches on a checkout
// path containing spaces (this repo's own path has one), and `main()` never runs.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`backfill failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}
