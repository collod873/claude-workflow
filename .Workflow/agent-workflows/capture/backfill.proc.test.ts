import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverTranscripts, lastTimestamp, runBackfill } from "./backfill";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const BACKFILL_PATH = join(REPO_ROOT, ".Workflow/agent-workflows/capture/backfill.ts");
const HOOK_PATH = join(REPO_ROOT, ".claude/hooks/session-capture-hook.mjs");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function writeTranscript(sourceDir: string, project: string, sessionId: string, lines: unknown[]): string {
  const projectDir = join(sourceDir, project);
  mkdirSync(projectDir, { recursive: true });
  const path = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

const FIXTURE_LINES = [
  {
    type: "user",
    uuid: "u1",
    timestamp: "2026-08-10T12:00:00.000Z",
    origin: { kind: "human" },
    promptSource: "typed",
    message: { content: "Please help me ship this." },
  },
  {
    type: "assistant",
    uuid: "a1",
    timestamp: "2026-08-10T12:00:05.000Z",
    message: { content: [{ type: "text", text: "Sure, I will get started on shipping this." }] },
  },
];

function runBackfillCli(sourceDir: string, outputDir: string, logPath: string): string {
  return execFileSync("npx", ["tsx", BACKFILL_PATH, sourceDir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, SESSION_CAPTURE_OUTPUT_DIR: outputDir, SESSION_CAPTURE_LOG_PATH: logPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function mdFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

function stripDate(markdown: string): string {
  return markdown.replace(/^date: .*$/m, "date: <normalized>");
}

describe("discoverTranscripts", () => {
  it("finds every <project>/<sessionId>.jsonl file under sourceDir", () => {
    const sourceDir = tmpDir("backfill-discover-");
    writeTranscript(sourceDir, "project-a", "11111111-aaaa-bbbb-cccc-111111111111", FIXTURE_LINES);
    writeTranscript(sourceDir, "project-b", "22222222-aaaa-bbbb-cccc-222222222222", FIXTURE_LINES);

    const refs = discoverTranscripts(sourceDir);

    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.project).sort()).toEqual(["project-a", "project-b"]);
    expect(refs.map((r) => r.sessionId).sort()).toEqual([
      "11111111-aaaa-bbbb-cccc-111111111111",
      "22222222-aaaa-bbbb-cccc-222222222222",
    ]);
  });

  it("ignores a non-.jsonl file sitting beside a project directory", () => {
    const sourceDir = tmpDir("backfill-discover-");
    writeTranscript(sourceDir, "project-a", "11111111-aaaa-bbbb-cccc-111111111111", FIXTURE_LINES);
    writeFileSync(join(sourceDir, "README.md"), "not a transcript");

    const refs = discoverTranscripts(sourceDir);

    expect(refs).toHaveLength(1);
  });

  it("returns an empty list for an empty sourceDir", () => {
    const sourceDir = tmpDir("backfill-discover-");
    expect(discoverTranscripts(sourceDir)).toEqual([]);
  });
});

describe("lastTimestamp", () => {
  it("returns the last valid timestamp field across the transcript's lines", () => {
    const jsonl = FIXTURE_LINES.map((l) => JSON.stringify(l)).join("\n");
    expect(lastTimestamp(jsonl)).toBe("2026-08-10T12:00:05.000Z");
  });

  it("returns undefined when no line carries a valid timestamp", () => {
    const jsonl = [JSON.stringify({ type: "user" }), "not json at all"].join("\n");
    expect(lastTimestamp(jsonl)).toBeUndefined();
  });
});

describe("runBackfill: per-transcript failure handling", () => {
  it("logs skipped transcript-unreadable and keeps going for a discovered file it can't read", () => {
    const sourceDir = tmpDir("backfill-src-");
    const outputDir = tmpDir("backfill-out-");
    const logPath = join(tmpDir("backfill-log-"), "session-capture.log");
    const path = writeTranscript(sourceDir, "project-a", "11111111-aaaa-bbbb-cccc-111111111111", FIXTURE_LINES);
    chmodSync(path, 0o000);

    const outcomes = runBackfill({ sourceDir, outputDir, logPath });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toContain("skipped transcript-unreadable");
    expect(readFileSync(logPath, "utf8")).toContain("skipped transcript-unreadable");
    expect(mdFiles(outputDir)).toEqual([]);
  });

  it("captures one file per transcript and logs captured <sessionId>", () => {
    const sourceDir = tmpDir("backfill-src-");
    const outputDir = tmpDir("backfill-out-");
    const logPath = join(tmpDir("backfill-log-"), "session-capture.log");
    writeTranscript(sourceDir, "project-a", "11111111-aaaa-bbbb-cccc-111111111111", FIXTURE_LINES);

    const outcomes = runBackfill({ sourceDir, outputDir, logPath });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe("captured 11111111-aaaa-bbbb-cccc-111111111111");
    expect(mdFiles(outputDir)).toHaveLength(1);
    expect(readFileSync(logPath, "utf8")).toContain("captured 11111111-aaaa-bbbb-cccc-111111111111");
  });
});

describe("runBackfill: scratch projects (#103 §2)", () => {
  it("declines a /tmp project directory and says so in the log, rather than dropping it silently", () => {
    const sourceDir = tmpDir("backfill-src-");
    const outputDir = tmpDir("backfill-out-");
    const logPath = join(tmpDir("backfill-log-"), "session-capture.log");
    writeTranscript(sourceDir, "-tmp-judge-obbwi8jl", "22222222-aaaa-bbbb-cccc-222222222222", FIXTURE_LINES);

    const outcomes = runBackfill({ sourceDir, outputDir, logPath });

    expect(outcomes[0].outcome).toBe("skipped scratch-project: -tmp-judge-obbwi8jl");
    expect(readFileSync(logPath, "utf8")).toContain("skipped scratch-project");
    expect(mdFiles(outputDir)).toEqual([]);
  });

  it("keeps a real repo whose name merely contains tmp", () => {
    const sourceDir = tmpDir("backfill-src-");
    const outputDir = tmpDir("backfill-out-");
    const logPath = join(tmpDir("backfill-log-"), "session-capture.log");
    writeTranscript(sourceDir, "-home-collin-tmpfile-tools", "33333333-aaaa-bbbb-cccc-333333333333", FIXTURE_LINES);

    const outcomes = runBackfill({ sourceDir, outputDir, logPath });

    expect(outcomes[0].outcome).toBe("captured 33333333-aaaa-bbbb-cccc-333333333333");
    expect(mdFiles(outputDir)).toHaveLength(1);
  });

  it("counts the scratch skips separately in the CLI's summary line", () => {
    const sourceDir = tmpDir("backfill-src-");
    const outputDir = tmpDir("backfill-out-");
    const logPath = join(tmpDir("backfill-log-"), "session-capture.log");
    writeTranscript(sourceDir, "-tmp-scratch-one", "44444444-aaaa-bbbb-cccc-444444444444", FIXTURE_LINES);
    writeTranscript(sourceDir, "project-a", "55555555-aaaa-bbbb-cccc-555555555555", FIXTURE_LINES);

    const stdout = runBackfillCli(sourceDir, outputDir, logPath);

    expect(stdout).toContain("1 captured");
    expect(stdout).toContain("1 scratch projects");
  });
});

describe("backfill.ts (CLI): output shape matches slice 1's capture-hook output", () => {
  it("produces a capture file structurally identical to the hook's own output for the same fixture transcript", () => {
    const sourceDir = tmpDir("backfill-src-");
    const outputDir = tmpDir("backfill-out-");
    const logPath = join(tmpDir("backfill-log-"), "session-capture.log");
    const hookOutputDir = tmpDir("backfill-hook-out-");
    const hookLogPath = join(tmpDir("backfill-hook-log-"), "session-capture.log");
    const hookKbDir = tmpDir("backfill-hook-kb-");
    const hookKbStampPath = join(tmpDir("backfill-hook-kb-stamp-"), "stamp");

    const sessionId = "abcdef12-3456-7890-abcd-ef1234567890";
    const project = "test-project";
    const transcriptPath = writeTranscript(sourceDir, project, sessionId, FIXTURE_LINES);

    runBackfillCli(sourceDir, outputDir, logPath);

    const backfillFile = mdFiles(outputDir)[0];
    expect(backfillFile).toBeDefined();
    const backfillContent = readFileSync(join(outputDir, backfillFile), "utf8");

    execFileSync("node", [HOOK_PATH, transcriptPath, sessionId, project, "backfill"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        SESSION_CAPTURE_OUTPUT_DIR: hookOutputDir,
        SESSION_CAPTURE_LOG_PATH: hookLogPath,
        SESSION_CAPTURE_KB_DIR: hookKbDir,
        SESSION_CAPTURE_KB_STAMP_PATH: hookKbStampPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const hookFile = mdFiles(hookOutputDir)[0];
    expect(hookFile).toBeDefined();
    const hookContent = readFileSync(join(hookOutputDir, hookFile), "utf8");

    expect(stripDate(backfillContent)).toBe(stripDate(hookContent));
  });
});

describe("backfill.ts (CLI): a second run over the same directory is a no-op", () => {
  it("writes zero new files and logs skipped already-captured for every transcript on a second run", () => {
    const sourceDir = tmpDir("backfill-src-");
    const outputDir = tmpDir("backfill-out-");
    const logPath = join(tmpDir("backfill-log-"), "session-capture.log");

    writeTranscript(sourceDir, "project-a", "11111111-aaaa-bbbb-cccc-111111111111", FIXTURE_LINES);
    writeTranscript(sourceDir, "project-b", "22222222-aaaa-bbbb-cccc-222222222222", FIXTURE_LINES);

    runBackfillCli(sourceDir, outputDir, logPath);

    const filesAfterFirst = mdFiles(outputDir);
    expect(filesAfterFirst).toHaveLength(2);
    const statsAfterFirst = filesAfterFirst.map((f) => statSync(join(outputDir, f)).mtimeMs);
    const contentsAfterFirst = filesAfterFirst.map((f) => readFileSync(join(outputDir, f), "utf8"));

    const logAfterFirst = readFileSync(logPath, "utf8");
    expect((logAfterFirst.match(/\tcaptured /g) ?? []).length).toBe(2);

    runBackfillCli(sourceDir, outputDir, logPath);

    const filesAfterSecond = mdFiles(outputDir);
    expect(filesAfterSecond).toEqual(filesAfterFirst);
    expect(filesAfterSecond.map((f) => statSync(join(outputDir, f)).mtimeMs)).toEqual(statsAfterFirst);
    expect(filesAfterSecond.map((f) => readFileSync(join(outputDir, f), "utf8"))).toEqual(contentsAfterFirst);

    const logAfterSecond = readFileSync(logPath, "utf8");
    expect((logAfterSecond.match(/skipped already-captured/g) ?? []).length).toBe(2);
    expect((logAfterSecond.match(/\tcaptured /g) ?? []).length).toBe(2);
  });
});
