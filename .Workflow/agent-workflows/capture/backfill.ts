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

const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 25;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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
    }
  }
}

function atomicWrite(targetPath: string, content: string): void {
  withLock(targetPath, () => {
    const tmpPath = `${targetPath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, targetPath);
  });
}

function log(logPath: string, outcome: string): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    appendFileSync(logPath, `${ts}\t${outcome}\n`);
  } catch {
  }
}

export interface TranscriptRef {
  path: string;
  project: string;
  sessionId: string;
}

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

export function isScratchProject(project: string): boolean {
  return project.startsWith("-tmp-");
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

export function runBackfill(opts: BackfillOptions): BackfillOutcome[] {
  const { sourceDir, outputDir, logPath } = opts;
  const transcripts = discoverTranscripts(sourceDir);

  mkdirSync(outputDir, { recursive: true });
  const captured = sessionSuffixesOf(safeReaddir(outputDir));

  const results: BackfillOutcome[] = [];

  for (const transcript of transcripts) {
    const sid8 = transcript.sessionId.slice(0, 8);

    if (isScratchProject(transcript.project)) {
      const outcome = `skipped scratch-project: ${transcript.project}`;
      log(logPath, outcome);
      results.push({ sessionId: transcript.sessionId, outcome });
      continue;
    }

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
  const count = (prefix: string): number => outcomes.filter((o) => o.outcome.startsWith(prefix)).length;
  const capturedCount = count("captured ");
  const scratchCount = count("skipped scratch-project");
  console.log(
    `backfill: ${capturedCount} captured, ${outcomes.length - capturedCount} skipped ` +
      `(${scratchCount} scratch projects, ${count("skipped already-captured")} already captured), ` +
      `${outcomes.length} total`,
  );
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`backfill failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}
