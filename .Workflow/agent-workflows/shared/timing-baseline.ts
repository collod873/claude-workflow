import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isMainModule } from "./baseline-gate.ts";

/**
 * Timing, recorded and never judged (ADR-0148).
 *
 * There is no committed number here and nothing compares one run's duration against another's.
 * What every run leaves behind is `.gauntlet-timings.json` at the target root — gitignored,
 * overwritten each run, and read by nothing in this module or in `bin/gauntlet`.
 *
 * One thing still reads a measured number: which test files the stop venue may run. That is file
 * *selection*, not judgement, and it uses only this workstation's own measurement
 * (`timing-baseline.local.json`, gitignored) admitted cheapest-first under a hard
 * {@link STOP_WALL_MS} wall. It never fails a run; it only decides which files stop gets to run
 * before the rest fall through to push.
 */

/** This machine's own measurement, gitignored — see the module docstring. */
export const LOCAL_BASELINE_RELATIVE_PATH =
  ".Workflow/agent-workflows/shared/timing-baseline.local.json";

/** What every gauntlet run leaves at the target root, gitignored and judged by nothing. */
export const TIMINGS_ARTIFACT_RELATIVE_PATH = ".gauntlet-timings.json";

/**
 * The stop venue's hard ceiling, in milliseconds. Files are admitted cheapest-first from this
 * workstation's own measurement until the next one would cross it; everything past that runs at
 * push instead. Fixed rather than a share of the suite, because a share is only meaningful relative
 * to a whole-suite measurement and the wall is meant to answer one question alone: how much does
 * this venue cost a turn end.
 */
export const STOP_WALL_MS = 5000;

/**
 * Acceptance tests are excluded from every selection here. They are *expected* to be red until the
 * ticket they name is built — that is what makes them acceptance tests rather than a report on
 * working code (`vitest.config.ts`) — and the venue that decides whether one may land is
 * `acceptance/push-gate.ts`, not a venue of the gauntlet.
 */
const ACCEPTANCE_PREFIX = "tests/acceptance/";

/** Agent worktrees: whole second checkouts under this tree, whose test files are never its own. */
const WORKTREES_DIR = ".claude/worktrees";

/** Where a measurement came from, recorded so a runner-class change shows up in a diff. */
export interface MachineFacts {
  cores: number;
  platform: string;
}

export function machineFacts(): MachineFacts {
  return { cores: availableParallelism(), platform: process.platform };
}

/** One `measure` run's answer: the suite's wall clock, and what each file inside it cost. */
export interface SuiteTiming {
  wallMs: number;
  measuredOn: MachineFacts;
  /** Repo-relative test file → its measured milliseconds. */
  files: Record<string, number>;
}

/** This workstation's own measurement, as written to {@link LOCAL_BASELINE_RELATIVE_PATH}. */
export interface LocalTiming {
  generated: string;
  wallMs: number;
  measuredOn: MachineFacts;
  files: Record<string, number>;
}

/** Serializes a value the way it is written to disk: two-space indent, trailing newline. */
function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Writes through a temp file in the same directory and a rename, because a half-written file reads
 * as no history at all rather than failing loudly, and two sessions writing at the same millisecond
 * is not rare enough to risk that.
 */
function writeThrough(path: string, value: unknown): void {
  const dir = path.slice(0, path.lastIndexOf("/")) || ".";
  const temp = join(dir, `.${path.slice(dir.length + 1)}.${process.pid}.tmp`);
  writeFileSync(temp, serialize(value));
  renameSync(temp, path);
}

/** This workstation's own measurement, or `undefined` when there is none yet or it cannot be read. */
export function readLocalTiming(root: string): LocalTiming | undefined {
  const path = join(root, LOCAL_BASELINE_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LocalTiming;
  } catch {
    // Unreadable is "no history yet", never a finding about the code.
    return undefined;
  }
}

export function writeLocalTiming(root: string, local: LocalTiming): void {
  writeThrough(join(root, LOCAL_BASELINE_RELATIVE_PATH), local);
}

/**
 * The test files a venue may run, chosen from `discovered` — what is in the tree *now* — or
 * `undefined` when there is nothing to choose from, in which case the caller runs its whole test
 * slot rather than guessing at a subset.
 *
 * `push` gets everything by definition: it is the venue that runs the whole suite, and it is where
 * a file lands when it outgrows the one above it. `stop` admits files cheapest-first from `local`'s
 * own measurement until the next one would cross {@link STOP_WALL_MS} — a selection, never a
 * verdict, and nothing here fails a run.
 *
 * A file with no measurement yet is treated as free and admitted first, the same "record rather
 * than judge" rule the rest of this module applies: a selection drawn only from the measured set
 * would silently never run a file written since the last measurement, which is a gate that goes
 * quieter exactly as a repo gets busier. The universe is the tree's, never the measurement's, so a
 * file that has left the tree is dropped whatever the measurement still says about it.
 */
export function selectFiles(
  local: LocalTiming | undefined,
  venue: string,
  discovered: readonly string[],
): string[] | undefined {
  const all = [...discovered].sort();
  if (venue === "push") return all;
  if (venue !== "stop") return undefined;
  if (!local) return undefined;
  const admitted = admitUnderWall(all, local.files, STOP_WALL_MS);
  return admitted;
}

/** Cheapest-first admission from `all`, stopping the instant the next file would cross `wallMs`. */
function admitUnderWall(
  all: readonly string[],
  files: Record<string, number>,
  wallMs: number,
): string[] {
  const byCost = [...all].sort((a, b) => (files[a] ?? 0) - (files[b] ?? 0));
  const admitted = new Set<string>();
  let total = 0;
  for (const file of byCost) {
    const cost = files[file] ?? 0;
    if (total + cost > wallMs) break;
    total += cost;
    admitted.add(file);
  }
  return all.filter((file) => admitted.has(file));
}

const TEST_FILE_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * Every test file under `root`, repo-relative — the universe `selectFiles` chooses from.
 *
 * Read off the filesystem on every run rather than kept in a measurement, because a measurement is
 * only as fresh as the last time it ran and the tree is not.
 *
 * Two directories are dropped, for the reasons `vitest.config.ts` gives for dropping them:
 * acceptance tests are expected-red until their ticket is built and belong to
 * `acceptance/push-gate.ts`, and `.claude/worktrees/` holds whole second checkouts whose test
 * files were never this tree's.
 */
export function discoverTestFiles(root: string): string[] {
  const found: string[] = [];
  const stack: string[] = [""];
  while (stack.length > 0) {
    const relDir = stack.pop();
    if (relDir === undefined) break;
    let entries;
    try {
      entries = readdirSync(join(root, relDir), { withFileTypes: true });
    } catch {
      // A directory that vanished between the walk and the read is not a finding about anything.
      continue;
    }
    for (const entry of entries) {
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && rel !== WORKTREES_DIR) stack.push(rel);
      } else if (TEST_FILE_NAME.test(entry.name) && !rel.startsWith(ACCEPTANCE_PREFIX)) {
        found.push(rel);
      }
    }
  }
  return found.sort();
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
 * Measures `root`'s suite and writes the result to this workstation's own
 * {@link LOCAL_BASELINE_RELATIVE_PATH} — the manual "re-measure by hand" form
 * (`node timing-baseline.ts measure .`), and the one writer of that file's per-file costs.
 */
export function measureAndWriteLocalTiming(
  root: string,
  measure: (root: string) => SuiteTiming = measureSuite,
): LocalTiming {
  const suite = measure(root);
  const local: LocalTiming = {
    generated: new Date().toISOString().slice(0, 10),
    wallMs: suite.wallMs,
    measuredOn: suite.measuredOn,
    files: suite.files,
  };
  writeLocalTiming(root, local);
  return local;
}

// --- What a run leaves behind ------------------------------------------------------------------

/** The whole of `.gauntlet-timings.json` — every field this module writes and nothing it judges. */
export interface RunTimings {
  generated: string;
  venue: string;
  wallMs: number;
  measuredOn: MachineFacts;
  checks: Record<string, number>;
}

/**
 * Writes `.gauntlet-timings.json` at `root`, overwriting whatever the previous run left. Never
 * throws for the *content* of `checks` — there is nothing here to judge it against — so the only
 * way out is a filesystem error, which the caller reports as a broken write rather than a finding.
 */
export function writeRunTimings(
  root: string,
  venue: string,
  wallMs: number,
  checks: Record<string, number>,
): void {
  const payload: RunTimings = {
    generated: new Date().toISOString().slice(0, 10),
    venue,
    wallMs,
    measuredOn: machineFacts(),
    checks,
  };
  writeThrough(join(root, TIMINGS_ARTIFACT_RELATIVE_PATH), payload);
}

// --- CLI --------------------------------------------------------------------------------------
//
//   node timing-baseline.ts measure <root>                measures the suite alone and refreshes
//                                                         this workstation's own local file — the
//                                                         manual "re-measure by hand" form
//   node timing-baseline.ts record <root> <venue> [--wall=<ms>] <check>=<ms>…
//                                                         writes .gauntlet-timings.json at <root>;
//                                                         never exits non-zero for what it was told,
//                                                         only for a broken write
//   node timing-baseline.ts files <root> <venue>          print the test files that venue may run,
//                                                         one per line; exits 1 with no output when
//                                                         there is nothing to answer from

interface Measurement {
  check: string;
  ms: number;
}

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
  const wallMs = wallArg === undefined ? 0 : Number(wallArg.slice(WALL_FLAG.length));

  let measurements: Measurement[];
  try {
    measurements = parseMeasurements(rest.filter((arg) => arg !== wallArg));
  } catch (err) {
    console.error(`timing: ${(err as Error).message}`);
    process.exit(2);
  }

  const checks: Record<string, number> = {};
  for (const { check, ms } of measurements) checks[check] = ms;

  try {
    writeRunTimings(root, venue, wallMs, checks);
  } catch (err) {
    console.error(
      `timing: could not write ${TIMINGS_ARTIFACT_RELATIVE_PATH}: ${(err as Error).message}`,
    );
    process.exit(2);
  }
  process.exit(0);
}

function runFiles(args: string[]): never {
  const [root, venue] = args;
  if (!root || !venue) {
    console.error("usage: timing-baseline.ts files <root> <venue>");
    process.exit(2);
  }
  const discovered = discoverTestFiles(root);
  const selected = selectFiles(readLocalTiming(root), venue, discovered);
  if (!selected) process.exit(1);
  process.stdout.write(`${selected.join("\n")}\n`);
  process.exit(0);
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "record") {
    runRecord(args.slice(1));
  } else if (args[0] === "files") {
    runFiles(args.slice(1));
  } else if (args[0] === "measure") {
    const root = args[1] ?? process.cwd();
    try {
      const local = measureAndWriteLocalTiming(root);
      console.log(
        `timed ${Object.keys(local.files).length} test file(s) in ${local.wallMs}ms → ` +
          LOCAL_BASELINE_RELATIVE_PATH,
      );
    } catch (err) {
      console.error(`timing: ${(err as Error).message}`);
      process.exit(2);
    }
  } else {
    console.error("usage: timing-baseline.ts <measure|record|files> ...");
    process.exit(2);
  }
}
