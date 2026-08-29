import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { childEnv } from "../shared/child-env";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";

/**
 * The gate a freshly authored acceptance test has to clear before it is
 * trusted with a commit on `main` — no PR, no review, because nobody wrote
 * these tests: `acceptance.ts`'s author stage did, from the spec alone, and
 * a model's test file is exactly the thing that must prove itself before it
 * gets to land unattended.
 *
 * **What "proves itself" means here.** Two failure shapes read identically
 * as "red" to a caller that only checks the exit code, and they are not
 * equally trustworthy:
 *
 *   - A test that *collected* and then failed with an `AssertionError` ran
 *     against the real subject and found it wanting — expected, for a test
 *     written before the ticket that satisfies it. Pushing this is the
 *     whole point: the criterion now has a red test waiting for whoever
 *     implements it.
 *   - A test that never collected — a typo'd import, a syntax error, a
 *     reference to a module that does not exist — proves nothing about the
 *     subject at all. It is broken, not merely failing, and a gate that
 *     cannot tell the two apart would push broken test files to `main` as
 *     readily as honest red ones.
 *
 * This gate refuses the second shape and pushes the first. It never
 * inspects *which* criteria passed or failed — that judgement belongs to
 * whoever implements the ticket the test is for.
 */

/** One test's outcome, as the classifier needs it — nothing else is read. */
export interface TestFailure {
  /** The test's own name, for the refusal message — never matched on. */
  name: string;
  /**
   * The name of the error the test threw, e.g. `"AssertionError"`. Anything
   * other than `"AssertionError"` is treated as a collection-shaped
   * failure: a test that ran but threw a `TypeError` reaching into
   * something that does not exist yet is exactly as untrustworthy as one
   * that failed to import.
   */
  errorName: string;
}

/** What one `runTests()` call reports, classified. */
export interface TestRunResult {
  /**
   * `false` when a syntax or import error kept a test file from ever being
   * collected — the run produced no assertions to grade because there was
   * nothing to run. `collectionError` names what a `false` here refuses on.
   */
  collected: boolean;
  /** Present only when `collected` is `false`. */
  collectionError?: string;
  /** Every test that ran and failed. Empty when every collected test passed. */
  failures: TestFailure[];
}

/** The only non-refusing verdict a failure may carry. */
const ASSERTION_FAILURE = "AssertionError";

/**
 * Where a commit this gate clears actually lands.
 *
 * ADR-0091: a job that spends a model holds `contents: read`, so it cannot push. Lane 04 spends an
 * Opus stage and then pushes straight to `main`, which means the push and the model were in one
 * job and one token — the arrangement ADR-0053 is careful about, and the one #181 found 403ing
 * everywhere else in this pipeline. Splitting it makes *where the commit goes* a property of the
 * venue, so this gate keeps deciding what may land and stops deciding who lands it.
 */
export type Landing =
  /** This process pushes to `main` itself — the workstation, and any job already holding a write token. */
  | "push"
  /** This process commits and stops. A job holding `contents: write` pushes what it left behind. */
  | "commit";

/**
 * `ACCEPTANCE_LANDING=commit` in the environment, or `"push"` — the default, and what every venue
 * that is not the split model job wants. Read at the CLI boundary rather than inside the gate, so
 * `runPushGate` stays a function of its arguments.
 */
export function landingFromEnv(env: NodeJS.ProcessEnv = process.env): Landing {
  return env.ACCEPTANCE_LANDING === "commit" ? "commit" : "push";
}

export interface PushGateDeps {
  /** Runs the newly authored acceptance suite and classifies the result. */
  runTests: () => TestRunResult | Promise<TestRunResult>;
  /**
   * Lints the paths this run is landing, returning the linter's report when it found something and
   * `null` when it is clean. Defaults to the real `runEslint`.
   *
   * **Why a red test is fine here and a lint error is not.** The classification above is built
   * around one distinction: an `AssertionError` is a test that ran and found its ticket unbuilt,
   * which is the whole point of landing it early. A lint error is neither — it is a file this repo
   * cannot accept in any state, and lane 04 pushes straight to `main` with no review, so the only
   * venue that can refuse one is this function. #240 landed three files violating
   * `acceptance-boundary/no-outside-import` and turned every local gate in the repository red for
   * work that had not started
   * ([ADR-0102](../../../docs/adr/0102-a-lint-rule-that-points-at-an-import-the-boundary-forbids-do.md)).
   */
  lint?: (paths: string[]) => string | null;
  git: GitExec;
  /** The acceptance test file paths this run is landing, repo-relative. */
  paths: string[];
  /** CLAUDE.md: explains why, not what — the caller's to write. */
  commitMessage: string;
  /** Defaults to `"push"`: the historical behaviour, and the right one anywhere a token exists. */
  landing?: Landing;
}

export type PushGateOutcome =
  | { verdict: "pushed" }
  | { verdict: "refused"; reason: string };

/**
 * Runs `deps.runTests`, classifies the result, and either commits+pushes
 * `deps.paths` straight to `main` or refuses without touching git at all.
 *
 * **Collect-and-classify, not merely "did it pass".** A freshly authored
 * acceptance test is *expected* to fail — the ticket it proves isn't built
 * yet — so "green" was never the bar. The bar is "every test collected, and
 * every failure is an honest `AssertionError`": a run that clears it may
 * still be entirely red, and that redness is the point of writing the test
 * before the ticket.
 *
 * Refuses before any git call on either failing condition, so a refused run
 * leaves `main` untouched — the property `push-gate.test.ts` asserts by
 * reading a fake `GitExec`'s `calls` rather than trusting a return value.
 */
export async function runPushGate(deps: PushGateDeps): Promise<PushGateOutcome> {
  const result = await deps.runTests();

  if (!result.collected) {
    return {
      verdict: "refused",
      reason: `a test file failed to collect: ${result.collectionError ?? "no detail reported"}`,
    };
  }

  const nonAssertion = result.failures.filter((failure) => failure.errorName !== ASSERTION_FAILURE);
  if (nonAssertion.length > 0) {
    const names = nonAssertion.map((failure) => `${failure.name} (${failure.errorName})`).join(", ");
    return {
      verdict: "refused",
      reason: `${nonAssertion.length} failure(s) are not AssertionErrors: ${names}`,
    };
  }

  // Last, and still before any git call: a batch that lints clean but is red is exactly what this
  // gate exists to land, while one that cannot lint is not landable in any state.
  const lintReport = (deps.lint ?? runEslint)(deps.paths);
  if (lintReport !== null) {
    return { verdict: "refused", reason: `the authored files do not lint:\n${lintReport}` };
  }

  commitAndPush(deps);
  return { verdict: "pushed" };
}

/**
 * Commits `deps.paths` and, unless the landing is delegated, pushes straight
 * to `main` — the same add-commit-fetch-rebase-push sequence
 * `watchdog/back-stamp-walk.ts` and `shape/accept.ts` use to land their own
 * unattended writes: this runs off an authoring pipeline with nobody watching
 * for a push that landed on `main` between the read and the write here, so it
 * rebases onto the latest rather than overwriting it blind.
 *
 * At `"commit"` it stops after the commit and the rebase-onto-latest happens
 * in the job that pushes, because that job is the one holding a token that can
 * fetch and push at all. What it leaves behind is a real commit on a real
 * branch, which is what `acceptance.yml` turns into a patch for that job.
 */
function commitAndPush(deps: PushGateDeps): void {
  deps.git(["add", ...deps.paths]);
  deps.git(["commit", "-m", deps.commitMessage]);
  if ((deps.landing ?? "push") === "commit") return;
  deps.git(["fetch", "origin", "main"]);
  deps.git(["rebase", "origin/main"]);
  deps.git(["push", "origin", "HEAD:main"]);
}

/**
 * The real `lint`: runs the repo's own eslint over exactly the paths being landed, and returns its
 * report or `null` when clean.
 *
 * Scoped to `paths` rather than the whole tree on purpose — this gate answers "may *these* files
 * land", and a pre-existing finding elsewhere is not this batch's to be refused for. eslint exits
 * non-zero on any finding, so the report is read off the caught error the same way `runVitestJson`
 * reads vitest's.
 */
export function runEslint(paths: string[]): string | null {
  if (paths.length === 0) return null;
  try {
    execFileSync("npx", ["eslint", ...paths], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv(),
    });
    return null;
  } catch (err) {
    const output = (err as { stdout?: string }).stdout;
    return typeof output === "string" && output.trim() !== "" ? output.trim() : reason(err);
  }
}

/**
 * Vitest's default JSON reporter (Jest-shaped): a `testResults` entry per
 * file, `assertionResults` per test inside it. A file that never collected
 * — the import itself threw — reports zero `assertionResults` and a
 * `message` naming why; that shape, not the process exit code, is what
 * `collected: false` reads off.
 */
interface VitestJsonAssertion {
  fullName?: string;
  title?: string;
  status: string;
  failureMessages?: string[];
}

interface VitestJsonTestResult {
  name: string;
  status: string;
  message?: string;
  assertionResults: VitestJsonAssertion[];
}

interface VitestJsonReport {
  testResults: VitestJsonTestResult[];
}

/** The error name a failure message opens with, e.g. `AssertionError: expected …` → `AssertionError`. */
function errorNameOf(failureMessage: string | undefined): string {
  if (!failureMessage) return "Error";
  const match = /^([A-Za-z][\w.]*)(?::| )/.exec(failureMessage.trim());
  return match ? match[1] : "Error";
}

/**
 * The real `runTests`: shells `npx vitest run <dir> --reporter=json` and
 * classifies its report. A non-zero exit is not itself a refusal signal —
 * vitest exits non-zero on any red test, collected or not — so this always
 * reads the JSON report rather than the exit code.
 */
export function runVitestJson(dir: string): TestRunResult {
  let stdout: string;
  try {
    stdout = execFileSync("npx", ["vitest", "run", dir, "--reporter=json"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv(),
    });
  } catch (err) {
    // vitest exits non-zero on a red suite, collected or not — the child's
    // stdout still carries the JSON report on that path (execFileSync
    // attaches it to the caught error), so this reads it the same way the
    // success branch does rather than treating a non-zero exit as failure.
    const output = (err as { stdout?: string }).stdout;
    if (typeof output !== "string" || output.trim() === "") {
      return { collected: false, collectionError: reason(err), failures: [] };
    }
    stdout = output;
  }

  let report: VitestJsonReport;
  try {
    report = JSON.parse(stdout) as VitestJsonReport;
  } catch (err) {
    return { collected: false, collectionError: `unparseable vitest JSON: ${reason(err)}`, failures: [] };
  }

  const failures: TestFailure[] = [];
  for (const file of report.testResults) {
    if (file.assertionResults.length === 0 && file.status === "failed") {
      return {
        collected: false,
        collectionError: `${file.name}: ${file.message ?? "failed to collect"}`,
        failures: [],
      };
    }
    for (const assertion of file.assertionResults) {
      if (assertion.status !== "failed") continue;
      failures.push({
        name: assertion.fullName ?? assertion.title ?? file.name,
        errorName: errorNameOf(assertion.failureMessages?.[0]),
      });
    }
  }

  return { collected: true, failures };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: push-gate.ts <acceptance-tests-dir> <commit-message> [path...]");
    process.exitCode = 1;
    return;
  }
  const commitMessage = process.argv[3] ?? `Land acceptance tests authored under ${dir}`;
  const paths = process.argv.slice(4).length > 0 ? process.argv.slice(4) : [dir];

  try {
    const outcome = await runPushGate({
      runTests: () => runVitestJson(dir),
      git: execGit,
      paths,
      commitMessage,
      landing: landingFromEnv(),
    });
    if (outcome.verdict === "refused") {
      console.error(`refused: ${outcome.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(landingFromEnv() === "commit" ? "committed" : "pushed");
  } catch (err) {
    console.error(`push-gate failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
