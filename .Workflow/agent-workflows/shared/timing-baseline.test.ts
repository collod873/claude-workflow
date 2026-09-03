import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_BASELINE_RELATIVE_PATH,
  STOP_WALL_MS,
  TIMINGS_ARTIFACT_RELATIVE_PATH,
  discoverTestFiles,
  machineFacts,
  measureAndWriteLocalTiming,
  readLocalTiming,
  selectFiles,
  writeLocalTiming,
  writeRunTimings,
  type LocalTiming,
} from "./timing-baseline.ts";

// ADR-0148: timing is recorded, never judged. Every case below is a claim about a *selection* —
// which files stop gets to run, what a run leaves on disk — never about a run being refused.

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function scratchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "timing-baseline-"));
  dirs.push(dir);
  return dir;
}

/** A local measurement holding exactly `files`, with everything else filled in plausibly. */
function localWith(files: Record<string, number>): LocalTiming {
  return {
    generated: "2026-01-01",
    wallMs: Object.values(files).reduce((a, b) => a + b, 0),
    measuredOn: machineFacts(),
    files,
  };
}

describe("machineFacts", () => {
  it("reports this process's own core count and platform", () => {
    const facts = machineFacts();

    expect(facts.cores).toBeGreaterThan(0);
    expect(facts.platform).toBe(process.platform);
  });
});

describe("finding the test files a venue could run", () => {
  it("reads them off the tree, skipping acceptance tests and nested worktrees", () => {
    const root = scratchRoot();
    for (const rel of [
      "src/a.test.ts",
      "src/plain.ts",
      "tests/acceptance/301-something.test.ts",
      ".claude/worktrees/other/src/b.test.ts",
      "node_modules/dep/c.test.ts",
    ]) {
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), "");
    }

    expect(discoverTestFiles(root)).toEqual(["src/a.test.ts"]);
  });
});

describe("the stop venue's wall", () => {
  it("is 5000ms", () => {
    expect(STOP_WALL_MS).toBe(5000);
  });

  it("returns everything at push, regardless of cost", () => {
    const local = localWith({ "a.test.ts": 10_000, "b.test.ts": 1 });

    expect(selectFiles(local, "push", ["b.test.ts", "a.test.ts"])).toEqual([
      "a.test.ts",
      "b.test.ts",
    ]);
  });

  it("admits every file when their combined cost fits under the wall", () => {
    const local = localWith({ "a.test.ts": 1_000, "b.test.ts": 2_000 });

    expect(selectFiles(local, "stop", ["a.test.ts", "b.test.ts"])).toEqual([
      "a.test.ts",
      "b.test.ts",
    ]);
  });

  // The criterion this ticket names: drive a file set over the wall and watch the overflow move to
  // push, with nothing failing along the way.
  it("admits cheapest-first and moves the overflow to push, without failing anything", () => {
    const local = localWith({
      "cheap.test.ts": 1_000,
      "middle.test.ts": 2_000,
      "expensive.test.ts": 4_000,
    });

    // cheap (1000) + middle (2000) = 3000, inside the wall; admitting expensive too would cross it.
    const admitted = selectFiles(local, "stop", [
      "expensive.test.ts",
      "middle.test.ts",
      "cheap.test.ts",
    ]);

    expect(admitted).toEqual(["cheap.test.ts", "middle.test.ts"]);
    expect(admitted).not.toContain("expensive.test.ts");
  });

  it("admits nothing when even the cheapest file alone would cross the wall", () => {
    const local = localWith({ "huge.test.ts": 6_000 });

    expect(selectFiles(local, "stop", ["huge.test.ts"])).toEqual([]);
  });

  it("treats an unmeasured file as free, so a file written since the last measurement still runs", () => {
    const local = localWith({ "known.test.ts": 4_999 });

    expect(selectFiles(local, "stop", ["known.test.ts", "brand-new.test.ts"])).toContain(
      "brand-new.test.ts",
    );
  });

  it("drops a file that has left the tree, whatever the measurement still says about it", () => {
    const local = localWith({ "gone.test.ts": 1, "here.test.ts": 1 });

    expect(selectFiles(local, "stop", ["here.test.ts"])).toEqual(["here.test.ts"]);
  });

  it("answers nothing at all until a measurement exists, so the caller runs its whole test slot", () => {
    expect(selectFiles(undefined, "stop", ["a.test.ts"])).toBeUndefined();
  });
});

describe("this workstation's own measurement", () => {
  it("round-trips through the gitignored local file", () => {
    const root = scratchRoot();
    mkdirSync(join(root, dirname(LOCAL_BASELINE_RELATIVE_PATH)), { recursive: true });

    expect(readLocalTiming(root)).toBeUndefined();

    const local = localWith({ "a.test.ts": 42 });
    writeLocalTiming(root, local);

    expect(readLocalTiming(root)).toEqual(local);
  });

  it("survives an unreadable file rather than throwing, reading it as no history yet", () => {
    const root = scratchRoot();
    const path = join(root, LOCAL_BASELINE_RELATIVE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json");

    expect(readLocalTiming(root)).toBeUndefined();
  });

  it("is what `measure` refreshes from a real suite run", () => {
    const root = scratchRoot();
    mkdirSync(join(root, dirname(LOCAL_BASELINE_RELATIVE_PATH)), { recursive: true });

    const local = measureAndWriteLocalTiming(root, () => ({
      wallMs: 5_000,
      measuredOn: { cores: 8, platform: "linux" },
      files: { "a.test.ts": 100 },
    }));

    expect(local.wallMs).toBe(5_000);
    expect(local.files["a.test.ts"]).toBe(100);
    expect(readLocalTiming(root)?.files["a.test.ts"]).toBe(100);
  });
});

describe("the durations a run leaves behind", () => {
  it("writes venue, wall time, per-check times and the core count, whatever the checks did", () => {
    const root = scratchRoot();

    writeRunTimings(root, "push", 12_345, { typecheck: 900, lint: 400 });

    const payload = JSON.parse(
      readFileSync(join(root, TIMINGS_ARTIFACT_RELATIVE_PATH), "utf8"),
    ) as {
      venue: string;
      wallMs: number;
      checks: Record<string, number>;
      measuredOn: { cores: number };
    };

    expect(payload.venue).toBe("push");
    expect(payload.wallMs).toBe(12_345);
    expect(payload.checks).toEqual({ typecheck: 900, lint: 400 });
    expect(payload.measuredOn.cores).toBeGreaterThan(0);
  });

  it("overwrites the previous run rather than accumulating history", () => {
    const root = scratchRoot();
    writeRunTimings(root, "stop", 1, { lint: 1 });
    writeRunTimings(root, "push", 2, { test: 2 });

    const payload = JSON.parse(
      readFileSync(join(root, TIMINGS_ARTIFACT_RELATIVE_PATH), "utf8"),
    ) as { venue: string };

    expect(payload.venue).toBe("push");
  });

  it("via its CLI form, never exits non-zero for an unusual measurement", () => {
    const root = scratchRoot();
    const run = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, "timing-baseline.ts"),
        "record",
        root,
        "push",
        "--wall=999999",
        "slow=999999",
      ],
      { encoding: "utf8" },
    );

    expect(run.status).toBe(0);
    expect(existsSync(join(root, TIMINGS_ARTIFACT_RELATIVE_PATH))).toBe(true);
  });
});

describe("the files a venue may run, from the CLI", () => {
  it("prints the stop selection, one file per line", () => {
    const root = scratchRoot();
    for (const rel of ["a.test.ts", "b.test.ts"]) writeFileSync(join(root, rel), "");
    mkdirSync(join(root, dirname(LOCAL_BASELINE_RELATIVE_PATH)), { recursive: true });
    writeLocalTiming(root, localWith({ "a.test.ts": 1, "b.test.ts": 2 }));

    const run = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, "timing-baseline.ts"), "files", root, "stop"],
      { encoding: "utf8" },
    );

    expect(run.status).toBe(0);
    expect(run.stdout.trim().split("\n").sort()).toEqual(["a.test.ts", "b.test.ts"]);
  });

  it("exits 1 with no output when there is nothing to answer from", () => {
    const root = scratchRoot();

    const run = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, "timing-baseline.ts"), "files", root, "stop"],
      { encoding: "utf8" },
    );

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
  });
});
