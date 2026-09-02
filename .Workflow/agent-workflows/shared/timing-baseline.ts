import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isMainModule } from "./baseline-gate.ts";

/**
 * The timing ratchet (#335). The gauntlet had baselines for structure — wiring, clones,
 * boundaries, each `regenerate && diff` — and none for time, so its venue budgets lived in a
 * comment in `bin/gauntlet` that said the suite was "~1.7s" while it ran in 13s, the stop venue
 * had been over its stated 10s on every turn-end for weeks, and every integrate run printed
 * `push took 60036ms against a 60000ms budget` to a stderr nobody reads. A number nothing
 * measures is not a budget; it is a comment about a budget.
 *
 * So time joins the same family: a venue's budget is **its own last green time plus a margin**,
 * never a figure this repo declares on some other repo's behalf. That is also #333's ruling — an
 * enrolled repository inherits its own history rather than this one's guess about it.
 *
 * ## Two files, because a number is only true where it was measured
 *
 * `timing-baseline.json` is committed and holds **the runner's** numbers. `timing-baseline.local.json`
 * is gitignored and holds whichever machine happens to be running. Nothing merges them: a run is
 * judged against the file for where it ran (`activeBaselinePath`).
 *
 * Only one thing writes the committed file — the `measure` mode below, from lane 05's
 * `regenerate-artifacts.ts` step, on the runner, before its push. A gauntlet run on a runner reads
 * it and never writes it: a hosted checkout is thrown away, so the write would only ever leave a
 * dirty tree behind for the lane that owns the commit. That is the same shape the clone and wiring
 * baselines already have — one generator, one step, one `git add`.
 *
 * Keying by machine *class* (core count, say) was the alternative and it leaks — this repo's
 * public runners have 4 cores, Lumaria's private ones have 2, and the workstation has 32, so the
 * key would have to travel with the file and mean something in every repo that installs the
 * pipeline. Splitting by *where it ran* needs no key at all: each repo's baseline lives in its own
 * tree and a repo runs on one runner class, so the committed file never sees two machines. The
 * core count is recorded as a **field** so a runner-class change is visible in a diff, never as a
 * key that selects a row.
 *
 * ## The margin cuts both ways
 *
 * A one-directional ratchet is a trap: one lucky fast run — a warm cache, an idle box — sets a bar
 * the next honest run cannot clear, and the gate goes red for the machine's mood. So the margin is
 * a deadband. Above `baseline + margin` is a finding; below `baseline - margin` is a genuine
 * improvement that rewrites the baseline; between them nothing happens and the file does not
 * churn. A check with no entry yet is recorded, never judged.
 *
 * ## What the numbers are for
 *
 * Two things, and they are measured differently. Per-*check* times (`venues`) are what a venue is
 * held to, and they are absolute, so they are only ever compared against numbers from the same
 * place. Per-*file* test times (`suite.files`) decide which files a venue may run, and they are
 * held as a **share of the suite's own wall clock** — a ratio, which survives the trip from a
 * 32-core workstation to a 2-core runner in a way an absolute millisecond count does not.
 */

/** The runner's numbers, committed. */
export const BASELINE_RELATIVE_PATH = ".Workflow/agent-workflows/shared/timing-baseline.json";

/** Whichever machine is running, gitignored — see the module docstring. */
export const LOCAL_BASELINE_RELATIVE_PATH =
  ".Workflow/agent-workflows/shared/timing-baseline.local.json";

/**
 * The deadband, as a percentage of the baseline, in both directions. 25% is where this started on
 * runners: a hosted runner's own variance run-to-run is a few percent on a check that does not
 * spawn processes and a good deal more on one that does, and 25% covers that without covering a
 * check that has genuinely doubled in cost.
 */
export const DEFAULT_MARGIN_PCT = 25;

/**
 * The floor under the percentage, in milliseconds. A check baselined at 40ms is inside the noise
 * of process startup, and 25% of it is 10ms — a margin that would report the operating system's
 * scheduling as a regression. Below this, a check is not slow enough to have a budget.
 */
export const MIN_SLACK_MS = 250;

/**
 * The largest share of the suite's own wall clock a single test file may cost and still run at the
 * stop venue. Three files carry 44% of this suite's clock because they spawn real processes on
 * purpose, and they are the reason the stop venue outgrew its budget; at 0.2 they run at push and
 * the rest of the suite stays where a failure is cheapest to repair.
 *
 * A share rather than a millisecond count, because the number has to mean the same thing on the
 * machine that measured it and the one that reads it.
 */
export const STOP_FILE_SHARE = 0.2;

/**
 * Acceptance tests are excluded from every selection here. They are *expected* to be red until the
 * ticket they name is built — that is what makes them acceptance tests rather than a report on
 * working code (`vitest.config.ts`) — and the venue that decides whether one may land is
 * `acceptance/push-gate.ts`, not a venue of the gauntlet.
 */
const ACCEPTANCE_PREFIX = "tests/acceptance/";

/** Where a venue's numbers came from, recorded so a runner-class change shows up in a diff. */
export interface MachineFacts {
  cores: number;
  platform: string;
}

/** One `measure` run's answer: the suite's wall clock, and what each file inside it cost. */
export interface SuiteTiming {
  /** The suite's own wall clock, the denominator every file share is taken against. */
  wallMs: number;
  measuredOn: MachineFacts;
  /** Repo-relative test file → its measured milliseconds. */
  files: Record<string, number>;
}

export interface TimingBaseline {
  generated: string;
  why: string;
  /** The deadband for this target, in percent — a repo that wants a wider one edits it here. */
  marginPct: number;
  /** The machine whose venue numbers these are. Absent until a run has recorded one. */
  measuredOn?: MachineFacts;
  /** venue → check name → milliseconds. */
  venues: Record<string, Record<string, number>>;
  /** Absent until `measure` has run; without it every file runs at every venue that runs tests. */
  suite?: SuiteTiming;
}

/** One check's measured wall time in a run being recorded. */
export interface Measurement {
  check: string;
  ms: number;
}

/** What judging a run's measurements against a baseline produced. */
export interface Verdict {
  /** The slowest check that exceeded its own budget, or `undefined` when the run is inside it. */
  over?: { check: string; ms: number; budgetMs: number };
  /** The baseline after the ratchet, or `undefined` when nothing moved and there is nothing to write. */
  next?: TimingBaseline;
  /** Checks that had no entry and were recorded rather than judged. */
  recorded: string[];
}

export function machineFacts(): MachineFacts {
  return { cores: availableParallelism(), platform: process.platform };
}

const DEFAULT_WHY =
  "Per-check wall times, ratcheted (#335). A venue's budget is its own last green time plus " +
  "the margin below, never a figure declared for it — so an enrolled repository inherits its " +
  "own history rather than this repo's guess about someone else's suite. The committed file " +
  "holds the runner's numbers; a workstation writes timing-baseline.local.json instead.";

export function emptyBaseline(): TimingBaseline {
  return {
    generated: new Date().toISOString().slice(0, 10),
    why: DEFAULT_WHY,
    marginPct: DEFAULT_MARGIN_PCT,
    venues: {},
  };
}

/**
 * Whether this process is running where the committed baseline's numbers come from. `CI` is the
 * variable every hosted runner sets and every local shell does not, which is the whole question —
 * not which CI product it is.
 */
export function isRunner(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CI ?? env.GITHUB_ACTIONS);
}

/**
 * The baseline a run happening here is judged against — the committed one on a runner, the
 * gitignored one anywhere else. A run is never judged against a file measured somewhere else,
 * which is the whole reason there are two.
 */
export function activeBaselinePath(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(root, isRunner(env) ? BASELINE_RELATIVE_PATH : LOCAL_BASELINE_RELATIVE_PATH);
}

export function readBaseline(path: string): TimingBaseline | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TimingBaseline;
  } catch {
    // A baseline this cannot parse is a broken measure, never a finding about the code. The caller
    // treats `undefined` as "no history yet" and records instead of judging.
    return undefined;
  }
}

/** Serializes a baseline the way it is committed: two-space indent, trailing newline. */
export function serializeBaseline(baseline: TimingBaseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

/**
 * Writes through a temp file in the same directory and a rename, because this is written from a
 * PostToolUse hook: two sessions in two worktrees of the same checkout end their turns at the same
 * millisecond often enough, and a half-written baseline reads as no history at all — which would
 * silently un-budget every venue rather than fail loudly.
 */
export function writeBaseline(path: string, baseline: TimingBaseline): void {
  const dir = path.slice(0, path.lastIndexOf("/")) || ".";
  const temp = join(dir, `.${path.slice(dir.length + 1)}.${process.pid}.tmp`);
  writeFileSync(temp, serializeBaseline(baseline));
  renameSync(temp, path);
}

/** The budget a check is held to: its baseline plus the margin, with `MIN_SLACK_MS` as the floor. */
export function budgetFor(baselineMs: number, marginPct: number): number {
  return baselineMs + Math.max((baselineMs * marginPct) / 100, MIN_SLACK_MS);
}

/** The time a check has to beat to move the ratchet down — the same margin, subtracted. */
export function ratchetFloor(baselineMs: number, marginPct: number): number {
  return baselineMs - Math.max((baselineMs * marginPct) / 100, MIN_SLACK_MS);
}

/**
 * Judges one green run's measurements against `baseline` and returns both the verdict and the
 * baseline to write.
 *
 * Only a green run should reach here: a failed check exits early and its wall time is a
 * measurement of the failure, not of the work.
 */
export function judge(
  baseline: TimingBaseline | undefined,
  venue: string,
  measurements: Measurement[],
): Verdict {
  const current = baseline ?? emptyBaseline();
  const marginPct = current.marginPct ?? DEFAULT_MARGIN_PCT;
  const recorded: string[] = [];
  const venueTimes = { ...(current.venues[venue] ?? {}) };
  let changed = false;
  let over: Verdict["over"];

  for (const { check, ms } of measurements) {
    const known = venueTimes[check];
    if (known === undefined) {
      venueTimes[check] = ms;
      recorded.push(check);
      changed = true;
      continue;
    }
    const budgetMs = budgetFor(known, marginPct);
    if (ms > budgetMs) {
      // The slowest offender, not the first one — the report has one line and it should name the
      // check whose repair actually moves the venue.
      if (!over || ms > over.ms) over = { check, ms, budgetMs };
      continue;
    }
    if (ms < ratchetFloor(known, marginPct)) {
      venueTimes[check] = ms;
      changed = true;
    }
  }

  if (!changed) return { over, recorded };
  return {
    over,
    recorded,
    next: {
      ...current,
      generated: new Date().toISOString().slice(0, 10),
      measuredOn: machineFacts(),
      venues: { ...current.venues, [venue]: venueTimes },
    },
  };
}

/**
 * The budget a venue as a whole is held to — the slowest of its checks' budgets, because the
 * checks run concurrently and a venue's wall clock is its slowest check rather than the sum of
 * them. `undefined` when the venue has no history yet, which is when nothing is judged.
 */
export function venueBudgetMs(
  baseline: TimingBaseline | undefined,
  venue: string,
): number | undefined {
  const times = baseline?.venues[venue];
  if (!times) return undefined;
  const marginPct = baseline?.marginPct ?? DEFAULT_MARGIN_PCT;
  const budgets = Object.values(times).map((ms) => budgetFor(ms, marginPct));
  return budgets.length === 0 ? undefined : Math.max(...budgets);
}

/**
 * The test files a venue may run, or `undefined` when the baseline cannot answer — no `measure`
 * has run, so nothing here knows what any file costs and the caller runs its whole test slot
 * rather than guessing at a subset.
 *
 * `push` gets everything by definition: it is the venue that runs the whole suite, and it is where
 * a file lands when it outgrows the one above it. `stop` gets every file costing at most
 * `STOP_FILE_SHARE` of the suite's own wall clock.
 *
 * This is the half of #335 that makes venue assignment automatic. The three process-spawning files
 * that carry 44% of this suite's clock move to push on the next `measure`, and any file that grows
 * past the share follows them without anyone noticing first.
 */
export function selectFiles(
  baseline: TimingBaseline | undefined,
  venue: string,
): string[] | undefined {
  const suite = baseline?.suite;
  if (!suite || suite.wallMs <= 0) return undefined;
  const all = Object.keys(suite.files).sort();
  if (venue === "push") return all;
  if (venue !== "stop") return undefined;
  const limitMs = suite.wallMs * STOP_FILE_SHARE;
  return all.filter((file) => suite.files[file] <= limitMs);
}

// --- Measuring the suite ----------------------------------------------------------------------

/** vitest's JSON reporter, as much of it as this reads. */
interface VitestJsonReport {
  testResults?: Array<{ name?: string; startTime?: number; endTime?: number }>;
}

/** Whether `<root>/node_modules/.bin/vitest` exists — the same precondition the contract probe checks. */
export function vitestBin(root: string): string | undefined {
  const bin = join(root, "node_modules", ".bin", "vitest");
  return existsSync(bin) ? bin : undefined;
}

/**
 * Runs the target's suite once under vitest's JSON reporter and returns what each file cost.
 *
 * The run's own wall clock is the denominator rather than the sum of the file times: the files run
 * across workers, so the sum is CPU time and the shares taken against it would understate every
 * file by the worker count.
 *
 * A red suite still measures — the numbers are the point here, not the verdict — so this reads the
 * report whatever vitest exited with, and only a report it cannot parse is a failure.
 */
export function measureSuite(root: string): SuiteTiming {
  const bin = vitestBin(root);
  if (bin === undefined) {
    throw new Error(`vitest is not installed in ${root} — nothing here can time a test file`);
  }

  const dir = mkdtempSync(join(tmpdir(), "timing-baseline-"));
  const reportPath = join(dir, "vitest.json");
  const startedAt = Date.now();
  try {
    // `--exclude` is additive to the config's own (vitest's `--help` says so), which is the only
    // reason this can drop the acceptance tests without restating the target's exclude list. They
    // are dropped because they are not the suite any venue runs: a red acceptance test is the
    // normal state of a ticket that has not been built yet, and its cost is not the unit suite's.
    const args = [
      "run",
      "--reporter=json",
      `--outputFile=${reportPath}`,
      "--exclude",
      `${ACCEPTANCE_PREFIX}**`,
    ];
    spawnSync(bin, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // The suite's own stdout is noise here; a broken *run* is caught by the missing report below.
      stdio: ["ignore", "ignore", "inherit"],
    });
    const wallMs = Date.now() - startedAt;

    let report: VitestJsonReport;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8")) as VitestJsonReport;
    } catch (err) {
      throw new Error(`vitest wrote no readable JSON report: ${(err as Error).message}`);
    }

    const files: Record<string, number> = {};
    for (const result of report.testResults ?? []) {
      if (!result.name || result.startTime === undefined || result.endTime === undefined) continue;
      const path = relative(root, result.name);
      if (path.startsWith(ACCEPTANCE_PREFIX)) continue;
      files[path] = Math.round(result.endTime - result.startTime);
    }
    if (Object.keys(files).length === 0) {
      throw new Error("vitest's JSON report named no test files");
    }

    return { wallMs, measuredOn: machineFacts(), files: sortedByKey(files) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sortedByKey(times: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(times).sort()) out[key] = times[key];
  return out;
}

/**
 * Refreshes the **committed** baseline from a fresh measurement of `root`: the `suite` half
 * outright, and the push venue's `test` entry through the same ratchet a gauntlet run goes through.
 *
 * The two halves answer different questions. `suite.files` decides which venue a file runs at, and
 * it is read only as a share of the same run's wall clock — a ratio, true wherever it was
 * measured. The push venue's `test` entry is an absolute millisecond count, so the ratchet applies:
 * a faster measurement tightens it, a slower one leaves it alone, and the run that refuses a push
 * over budget is `bin/gauntlet`'s, not this one's. A generator that could *raise* a budget by
 * running slowly would be a gate that unlocks itself.
 *
 * The push venue's other checks are not measured here. They are each a fraction of the suite's
 * cost, and `venueBudgetMs` takes the slowest check rather than the sum — so the number this
 * writes is the number the venue is actually held to.
 *
 * Run off a runner — seeding the file by hand, or a developer curious about the numbers — and the
 * `venues` half is left alone entirely. The whole point of the committed file is that it holds
 * times measured where the judging happens, and a workstation's 14s suite written there is a
 * budget no hosted runner can clear.
 */
export function writeSuiteTiming(
  root: string,
  measure: (root: string) => SuiteTiming = measureSuite,
): SuiteTiming {
  const path = join(root, BASELINE_RELATIVE_PATH);
  const existing = readBaseline(path) ?? emptyBaseline();
  const suite = measure(root);
  const ratcheted = isRunner()
    ? (judge(existing, "push", [{ check: "test", ms: suite.wallMs }]).next ?? existing)
    : existing;
  writeBaseline(path, {
    ...ratcheted,
    generated: new Date().toISOString().slice(0, 10),
    suite,
  });
  return suite;
}

// --- CLI --------------------------------------------------------------------------------------
//
//   node timing-baseline.ts <root>                        measure the suite, refresh `suite` in the
//                                                         committed baseline (the generator form
//                                                         `regenerate-artifacts.ts` invokes)
//   node timing-baseline.ts record <root> <venue> [--wall=<ms>] <check>=<ms>…
//                                                         ratchet one green run; exits 1 and names
//                                                         the slowest check when it is over budget
//   node timing-baseline.ts files <root> <venue>          print the test files that venue may run,
//                                                         one per line; exits 1 with no output when
//                                                         the baseline cannot answer
//
// `record` prints its own report on stderr and exits 1 on an over-budget run; what that costs is
// the *caller's* decision, because it differs by venue — `bin/gauntlet` refuses at push and
// reports at turn and stop (ADR-0015: a gate that goes red for environment reasons is how a repo
// learns to ignore its gates, and a turn-end block on a busy machine is exactly that).

function parseMeasurements(args: string[]): Measurement[] {
  const measurements: Measurement[] = [];
  for (const arg of args) {
    const at = arg.lastIndexOf("=");
    const check = at === -1 ? "" : arg.slice(0, at);
    const ms = Number(arg.slice(at + 1));
    if (!check || !Number.isFinite(ms)) {
      throw new Error(`"${arg}" is not a <check>=<ms> measurement`);
    }
    measurements.push({ check, ms });
  }
  return measurements;
}

const WALL_FLAG = "--wall=";

function runRecord(args: string[]): never {
  const [root, venue, ...rest] = args;
  if (!root || !venue) {
    console.error("usage: timing-baseline.ts record <root> <venue> [--wall=<ms>] <check>=<ms>...");
    process.exit(2);
  }
  const wallArg = rest.find((arg) => arg.startsWith(WALL_FLAG));
  const wallMs = wallArg === undefined ? undefined : Number(wallArg.slice(WALL_FLAG.length));

  let measurements: Measurement[];
  try {
    measurements = parseMeasurements(rest.filter((arg) => arg !== wallArg));
  } catch (err) {
    console.error(`timing: ${(err as Error).message}`);
    process.exit(2);
  }

  const path = activeBaselinePath(root);
  const before = readBaseline(path);
  const marginPct = before?.marginPct ?? DEFAULT_MARGIN_PCT;
  const verdict = judge(before, venue, measurements);
  // A runner judges against the committed baseline and writes nothing: its checkout is thrown away
  // at the end of the job, so the only thing a write there could produce is a dirty tree under the
  // lane that owns the commit. `measure` is what puts a runner's numbers in that file.
  if (verdict.next && !isRunner()) {
    try {
      writeBaseline(path, verdict.next);
    } catch (err) {
      // A baseline that cannot be written is a broken measure, not a finding about the code.
      console.error(`timing: could not write ${path}: ${(err as Error).message}`);
      process.exit(2);
    }
  }

  // The venue line, kept in the shape `bin/gauntlet` printed before it had a baseline to read —
  // `gauntlet-hook.mjs` finds it by "against a" and shows it to the person, not to Claude. The
  // budget it names is derived rather than stored: the checks run concurrently, so a venue's wall
  // clock is its slowest check's budget, not the sum of them.
  const venueBudget = venueBudgetMs(before, venue);
  if (wallMs !== undefined && venueBudget !== undefined && wallMs > venueBudget) {
    console.error(
      `gauntlet: ${venue} took ${Math.round(wallMs)}ms against a ${Math.round(venueBudget)}ms budget`,
    );
  }

  if (verdict.over) {
    const { check, ms, budgetMs } = verdict.over;
    console.error(
      `gauntlet: the slowest check over budget is ${check} — ${Math.round(ms)}ms against ` +
        `${Math.round(budgetMs)}ms, its own last green time plus ${marginPct}%`,
    );
    process.exit(1);
  }
  process.exit(0);
}

function runFiles(args: string[]): never {
  const [root, venue] = args;
  if (!root || !venue) {
    console.error("usage: timing-baseline.ts files <root> <venue>");
    process.exit(2);
  }
  const selected = selectFiles(readBaseline(activeBaselinePath(root)), venue) ??
    selectFiles(readBaseline(join(root, BASELINE_RELATIVE_PATH)), venue);
  if (!selected) process.exit(1);
  process.stdout.write(`${selected.join("\n")}\n`);
  process.exit(0);
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "record") runRecord(args.slice(1));
  if (args[0] === "files") runFiles(args.slice(1));
  const root = args[0] ?? process.cwd();
  try {
    const suite = writeSuiteTiming(root);
    console.log(
      `timed ${Object.keys(suite.files).length} test file(s) in ${suite.wallMs}ms → ${BASELINE_RELATIVE_PATH}`,
    );
  } catch (err) {
    console.error(`timing: ${(err as Error).message}`);
    process.exit(2);
  }
}
