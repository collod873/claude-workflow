import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MACHINE_ROOT } from "./run-gauntlet.ts";
import {
  BASELINE_RELATIVE_PATH,
  DEFAULT_MARGIN_PCT,
  LOCAL_BASELINE_RELATIVE_PATH,
  MIN_SLACK_MS,
  REPORT_ONLY_EXIT,
  STOP_FILE_SHARE,
  activeBaselinePath,
  discoverTestFiles,
  emptyBaseline,
  judge,
  readBaseline,
  selectFiles,
  venueBudgetMs,
  writeBaseline,
  writeSuiteTiming,
  type SuiteTiming,
  type TimingBaseline,
} from "./timing-baseline.ts";

// The ratchet's whole value is that it moves in one direction and only outside the noise. Every
// case below is a claim about *when* it moves, because a baseline that churned on every run would
// be regenerated reflexively rather than read — the same argument `wiring-baseline.ts` makes about
// its own line numbers.

/**
 * The one case below that spawns a real `bin/gauntlet push` rather than judging in-process. It
 * runs a scratch target's three checks and this repo's eight push-only ones, and a cold hosted
 * runner takes rather longer over that than the workstation that wrote the number — a 5s default
 * would turn that difference into an environment flake in the gate's own suite.
 */
const REAL_PUSH_RUN = 60_000;

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function scratchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "timing-baseline-"));
  dirs.push(dir);
  return dir;
}

/** A baseline holding one venue's checks, with everything else at its default. */
function baselineWith(venues: TimingBaseline["venues"], suite?: TimingBaseline["suite"]): TimingBaseline {
  return { ...emptyBaseline(), venues, suite };
}

describe("recording a check that has no history", () => {
  it("records it rather than judging it", () => {
    const verdict = judge(baselineWith({}), "push", [{ check: "test", ms: 13_000 }]);

    expect(verdict.over).toBeUndefined();
    expect(verdict.recorded).toEqual(["test"]);
    expect(verdict.next?.venues.push.test).toBe(13_000);
  });

  it("judges the checks that do have history in the same run", () => {
    const verdict = judge(baselineWith({ push: { typecheck: 2_000 } }), "push", [
      { check: "typecheck", ms: 9_000 },
      { check: "test", ms: 13_000 },
    ]);

    expect(verdict.recorded).toEqual(["test"]);
    expect(verdict.over?.check).toBe("typecheck");
  });
});

describe("the deadband", () => {
  const baseline = baselineWith({ push: { test: 10_000 } });

  it("fails a run past the baseline plus the margin, naming the check", () => {
    const verdict = judge(baseline, "push", [{ check: "test", ms: 14_000 }]);

    expect(verdict.over).toEqual({ check: "test", ms: 14_000, budgetMs: 12_500 });
  });

  it("leaves the baseline alone on a run it fails, so a slow day cannot become the new bar", () => {
    const verdict = judge(baseline, "push", [{ check: "test", ms: 14_000 }]);

    expect(verdict.next).toBeUndefined();
  });

  it("does nothing at all inside the band, in either direction", () => {
    for (const ms of [8_500, 10_000, 12_000]) {
      const verdict = judge(baseline, "push", [{ check: "test", ms }]);

      expect(verdict.over).toBeUndefined();
      expect(verdict.next).toBeUndefined();
    }
  });

  // The half a one-directional ratchet gets wrong: one lucky fast run — a warm cache, an idle box —
  // sets a bar the next honest run cannot clear, and the gate goes red for the machine's mood.
  it("tightens only when a run beats the baseline by more than the margin", () => {
    expect(judge(baseline, "push", [{ check: "test", ms: 7_600 }]).next).toBeUndefined();
    expect(judge(baseline, "push", [{ check: "test", ms: 6_000 }]).next?.venues.push.test).toBe(6_000);
  });

  it("gives a check too small to have a budget the absolute floor instead of a percentage of noise", () => {
    const tiny = baselineWith({ turn: { lint: 40 } });

    // 25% of 40ms is 10ms — a margin that would report the scheduler as a regression.
    expect(judge(tiny, "turn", [{ check: "lint", ms: 200 }]).over).toBeUndefined();
    expect(judge(tiny, "turn", [{ check: "lint", ms: 40 + MIN_SLACK_MS + 1 }]).over?.check).toBe("lint");
  });
});

describe("naming the offender", () => {
  it("names the slowest check over budget, not the first one seen", () => {
    const baseline = baselineWith({ push: { lint: 1_000, test: 10_000 } });

    const verdict = judge(baseline, "push", [
      { check: "lint", ms: 5_000 },
      { check: "test", ms: 20_000 },
    ]);

    expect(verdict.over?.check).toBe("test");
  });
});

describe("a venue's own budget", () => {
  // The checks run concurrently, so a venue's wall clock is its slowest check rather than the sum.
  it("is the slowest check's budget", () => {
    const baseline = baselineWith({ push: { typecheck: 2_000, lint: 2_000, test: 10_000 } });

    expect(venueBudgetMs(baseline, "push")).toBe(12_500);
  });

  it("is absent for a venue with no history, which is when nothing is judged", () => {
    expect(venueBudgetMs(baselineWith({}), "push")).toBeUndefined();
    expect(venueBudgetMs(undefined, "push")).toBeUndefined();
  });

  it("reads the margin the target declares rather than this file's default", () => {
    const baseline = { ...baselineWith({ push: { test: 10_000 } }), marginPct: 100 };

    expect(venueBudgetMs(baseline, "push")).toBe(20_000);
    expect(DEFAULT_MARGIN_PCT).toBe(25);
  });
});

describe("which files a venue runs", () => {
  // The three files #335 names spawn real processes on purpose and carry 44% of this suite's
  // clock. Nothing here is a hand-kept list of them: they are over the share, which is the only
  // thing that decides it, so a file that grows past it later moves on its own.
  const suite = {
    wallMs: 13_000,
    measuredOn: { cores: 4, platform: "linux" },
    files: {
      ".Workflow/agent-workflows/shared/clone-gate.test.ts": 4_800,
      ".claude/hooks/gauntlet.test.ts": 5_800,
      ".claude/hooks/session-capture.test.ts": 4_300,
      "quick.test.ts": 120,
      "slowish.test.ts": 2_500,
    },
  };
  const baseline = baselineWith({}, suite);
  const inTree = Object.keys(suite.files);

  it("keeps the stop venue to files inside its share of the suite", () => {
    expect(selectFiles(baseline, "stop", inTree)).toEqual(["quick.test.ts", "slowish.test.ts"]);
    expect(2_500).toBeLessThanOrEqual(suite.wallMs * STOP_FILE_SHARE);
  });

  it("runs everything at push, which is where a file lands when it outgrows stop", () => {
    expect(selectFiles(baseline, "push", inTree)).toHaveLength(5);
  });

  it("answers nothing at all until a measurement exists, so the caller runs its whole test slot", () => {
    expect(selectFiles(baselineWith({}), "stop", inTree)).toBeUndefined();
    expect(selectFiles(undefined, "stop", inTree)).toBeUndefined();
  });

  it("moves a file to push the moment it outgrows the share, with no list to edit", () => {
    const grown = baselineWith({}, {
      ...suite,
      files: { ...suite.files, "slowish.test.ts": 9_000 },
    });

    expect(selectFiles(grown, "stop", inTree)).toEqual(["quick.test.ts"]);
  });

  // The universe is the tree's, not the baseline's. A file written since the last measurement has
  // no entry, and a selection drawn from the measured set would silently never run it — a gate
  // that goes quieter exactly as a repo gets busier.
  it("runs a file the measurement has never seen rather than dropping it", () => {
    expect(selectFiles(baseline, "stop", [...inTree, "brand-new.test.ts"])).toContain(
      "brand-new.test.ts",
    );
  });

  it("drops a file that has left the tree, whatever the baseline still says about it", () => {
    expect(selectFiles(baseline, "stop", ["quick.test.ts"])).toEqual(["quick.test.ts"]);
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

describe("where a run's numbers are kept", () => {
  // Split by where it ran, never by a machine key: this repo's public runners have 4 cores,
  // Lumaria's private ones have 2 and the workstation has 32, so a key would have to mean
  // something in every repo the pipeline installs into. Each repo's baseline lives in its own tree
  // and a repo runs on one runner class, so the committed file never sees two machines.
  it("judges a runner against the committed baseline", () => {
    expect(activeBaselinePath("/repo", { CI: "true" })).toBe(join("/repo", BASELINE_RELATIVE_PATH));
  });

  it("judges a workstation against its own gitignored one", () => {
    expect(activeBaselinePath("/repo", {})).toBe(join("/repo", LOCAL_BASELINE_RELATIVE_PATH));
  });

  it("survives a half-written file rather than reading it as no history", () => {
    const root = scratchRoot();
    const path = join(root, "baseline.json");

    expect(readBaseline(path)).toBeUndefined();

    writeBaseline(path, baselineWith({ push: { test: 10_000 } }));

    expect(readBaseline(path)?.venues.push.test).toBe(10_000);
  });

  it("has one writer for the committed file, so a runner's throwaway checkout leaves no dirty tree", () => {
    // Everything a hosted job measures is discarded with the job. `measure`, from lane 05's
    // regenerate step, is what puts a runner's numbers in the committed file — the same one
    // generator, one step, one `git add` shape the clone and wiring baselines already have.
    const root = scratchRoot();
    const run = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, "timing-baseline.ts"),
        "record",
        root,
        "push",
        "test=99999",
      ],
      { encoding: "utf8", env: { ...process.env, CI: "true" } },
    );

    expect(run.status).toBe(0);
    expect(existsSync(join(root, BASELINE_RELATIVE_PATH))).toBe(false);
    expect(existsSync(join(root, LOCAL_BASELINE_RELATIVE_PATH))).toBe(false);
  });

  // The split these cases pin is `runRecord`'s, and `REPORT_ONLY_EXIT` carries its why (ADR-0142).
  describe("what going over budget costs", () => {
    function recordOverBudget(env: NodeJS.ProcessEnv): number | null {
      const root = scratchRoot();
      const relative = env.CI ? BASELINE_RELATIVE_PATH : LOCAL_BASELINE_RELATIVE_PATH;
      mkdirSync(join(root, dirname(relative)), { recursive: true });
      writeBaseline(join(root, relative), baselineWith({ push: { boundaries: 900 } }));

      return spawnSync(
        process.execPath,
        [resolve(import.meta.dirname, "timing-baseline.ts"), "record", root, "push", "boundaries=5000"],
        { encoding: "utf8", env: { ...process.env, CI: "", GITHUB_ACTIONS: "", ...env } },
      ).status;
    }

    it("exits 1 against the committed baseline, so the push venue refuses", () => {
      expect(recordOverBudget({ CI: "true" })).toBe(1);
    });

    it("exits REPORT_ONLY_EXIT against a workstation's own, so the push venue reports instead", () => {
      expect(recordOverBudget({})).toBe(REPORT_ONLY_EXIT);
    });

    /**
     * The same over-budget run, driven through the venue that pays for it: a scratch target whose
     * typecheck takes a second against a baseline seeded at 1ms, checked by the machine's real
     * `bin/gauntlet push`. `env` decides which baseline judges it, exactly as `activeBaselinePath`
     * reads it, so the two runs differ only in where the number came from.
     */
    function pushOverBudget(env: NodeJS.ProcessEnv): number | null {
      const root = scratchRoot();
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          name: "scratch",
          private: true,
          scripts: { typecheck: "sleep 1", lint: "true", test: "true" },
        }),
      );
      const generate = spawnSync(
        process.execPath,
        [join(MACHINE_ROOT, ".Workflow/agent-workflows/shared/generate-contract.ts"), root],
        { encoding: "utf8" },
      );
      expect(generate.status).toBe(0);

      const relative = env.CI ? BASELINE_RELATIVE_PATH : LOCAL_BASELINE_RELATIVE_PATH;
      mkdirSync(join(root, dirname(relative)), { recursive: true });
      writeBaseline(join(root, relative), baselineWith({ push: { typecheck: 1 } }));

      // `VITEST` is what the suite this test runs in leaks into the child, and the timing block
      // skips itself when it sees one — a run under it would prove nothing about either code.
      return spawnSync(join(MACHINE_ROOT, "bin/gauntlet"), ["push"], {
        encoding: "utf8",
        cwd: MACHINE_ROOT,
        env: {
          ...process.env,
          CI: "",
          GITHUB_ACTIONS: "",
          ...env,
          TARGET_WORKSPACE: root,
          VITEST: "",
          GAUNTLET_TIMING: "on",
        },
      }).status;
    }

    it(
      "is a code the push venue does not refuse on, unlike the 1 above",
      () => {
        // What an exit code costs is the caller's decision, and the caller is shell, so the claim
        // is what a real push does with each code rather than which line of `bin/gauntlet` reads
        // it. 2 is the third code in play — a broken measure, which a report-only run is not.
        expect(REPORT_ONLY_EXIT).not.toBe(2);
        expect(pushOverBudget({ CI: "true" })).toBe(1);
        expect(pushOverBudget({ CI: "" })).toBe(0);
      },
      REAL_PUSH_RUN,
    );
  });

  // The two halves of the committed file are true in different places. A file's share of the
  // suite survives the trip from a 32-core workstation to a 2-core runner; the absolute
  // milliseconds behind it do not, and a workstation's 14s suite written there as the push venue's
  // budget is a bar no hosted runner could clear. A `venues` entry is also only true when it was
  // measured *in* the venue — see the runner case below.
  describe("seeding the committed file", () => {
    const measured: SuiteTiming = {
      wallMs: 14_000,
      measuredOn: { cores: 32, platform: "linux" },
      files: { "a.test.ts": 100 },
    };

    function seed(): TimingBaseline {
      const root = scratchRoot();
      mkdirSync(join(root, dirname(BASELINE_RELATIVE_PATH)), { recursive: true });
      writeSuiteTiming(root, () => measured);
      return readBaseline(join(root, BASELINE_RELATIVE_PATH))!;
    }

    it("writes the suite half wherever it is run", () => {
      vi.stubEnv("CI", "");

      expect(seed().suite?.files["a.test.ts"]).toBe(100);
    });

    it("leaves the venue half alone off a runner", () => {
      vi.stubEnv("CI", "");

      expect(seed().venues.push).toBeUndefined();
    });

    it("leaves the venue half alone on a runner too — a solo measurement is never a venue's budget (ADR-0142)", () => {
      // This measures the suite alone; `bin/gauntlet` judges `test` while a dozen checks run
      // beside it. Writing the solo number here set a bar in a quiet room that the venue then
      // defended in a crowded one, and the push went red on contention never in the baseline.
      // `record`, called from a venue run, is now the only writer of a `venues` entry.
      vi.stubEnv("CI", "true");

      expect(seed().venues.push).toBeUndefined();
    });
  });

  it("records the machine a venue's numbers came from, as a field and not as a key", () => {
    const verdict = judge(baselineWith({}), "push", [{ check: "test", ms: 13_000 }]);

    expect(verdict.next?.measuredOn?.cores).toBeGreaterThan(0);
    expect(Object.keys(verdict.next?.venues ?? {})).toEqual(["push"]);
  });
});
