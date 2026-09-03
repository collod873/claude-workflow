import { execFileSync } from "node:child_process";
import { childEnv } from "./child-env";
import { reason } from "./reason";

/**
 * One `vitest run` shelled out and read back as a classified report — the runner two lanes share.
 * `acceptance/acceptance.ts`'s `landAuthoredBatch` grades a freshly authored acceptance test with
 * it (did the file even collect? is it green under `test.fails`?), and `fixer/fixer.ts` reproduces
 * a pull request's red from `runVitestReport` below. (`implement/implement.ts` no longer runs a
 * suite for its brief — since #360 it greps for the slice's `test.fails(` marker instead.)
 * Both need the same distinction, so it lives here rather than one lane importing the other's.
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

/**
 * Vitest's default JSON reporter (Jest-shaped): a `testResults` entry per
 * file, `assertionResults` per test inside it. A file that never collected
 * — the import itself threw — reports zero `assertionResults` and a
 * `message` naming why; that shape, not the process exit code, is what
 * `collected: false` reads off.
 */
export interface VitestJsonAssertion {
  fullName?: string;
  title?: string;
  status: string;
  failureMessages?: string[];
}

export interface VitestJsonTestResult {
  name: string;
  status: string;
  message?: string;
  assertionResults: VitestJsonAssertion[];
}

export interface VitestJsonReport {
  testResults: VitestJsonTestResult[];
}

/**
 * Shells `npx vitest run <targets> --reporter=json` in `repoDir` and hands back the parsed report,
 * or the one-line reason there is none. A non-zero exit is not itself a failure signal — vitest
 * exits non-zero on any red test, collected or not — and the child's stdout still carries the JSON
 * on that path (`execFileSync` attaches it to the caught error), so the report is read the same way
 * either way. Two callers classify it differently (`runVitestJson` here, `fixer.ts`'s signature
 * reader), which is why the spawn and the parse live once, apart from either classification.
 */
export function runVitestReport(targets: string[], repoDir: string): { report: VitestJsonReport } | { error: string } {
  let stdout: string;
  try {
    stdout = execFileSync("npx", ["vitest", "run", ...targets, "--reporter=json"], {
      cwd: repoDir,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv(),
    });
  } catch (err) {
    const output = (err as { stdout?: string }).stdout;
    if (typeof output !== "string" || output.trim() === "") return { error: reason(err) };
    stdout = output;
  }
  try {
    return { report: JSON.parse(stdout) as VitestJsonReport };
  } catch (err) {
    return { error: `unparseable vitest JSON: ${reason(err)}` };
  }
}

/** The error name a failure message opens with, e.g. `AssertionError: expected …` → `AssertionError`. */
function errorNameOf(failureMessage: string | undefined): string {
  if (!failureMessage) return "Error";
  const match = /^([A-Za-z][\w.]*)(?::| )/.exec(failureMessage.trim());
  return match ? match[1] : "Error";
}

/**
 * The real `runTests`: one `vitest run <dir>` through `runVitestReport`, classified — did every
 * file collect, and which assertions failed with which error name.
 */
export function runVitestJson(dir: string, repoDir: string = process.cwd()): TestRunResult {
  const ran = runVitestReport([dir], repoDir);
  if ("error" in ran) return { collected: false, collectionError: ran.error, failures: [] };
  const { report } = ran;

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
