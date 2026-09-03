import { execFileSync } from "node:child_process";
import { childEnv } from "./child-env";
import { reason } from "./reason";

/**
 * One `vitest run` shelled out and read back as a classified report — the runner two lanes share.
 * `acceptance/push-gate.ts` grades a freshly authored acceptance test with it (did the file even
 * collect?), and `implement/implement.ts` finds the failing test files for a ticket's brief with it.
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
export function runVitestJson(dir: string, repoDir: string = process.cwd()): TestRunResult {
  let stdout: string;
  try {
    stdout = execFileSync("npx", ["vitest", "run", dir, "--reporter=json"], {
      cwd: repoDir,
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
