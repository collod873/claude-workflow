import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childEnv } from "./child-env";
import { reason } from "./reason";

const CONFIG_NAMES = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
];

function targetVitestConfig(repoDir: string): string | undefined {
  return CONFIG_NAMES.map((name) => join(repoDir, name)).find((path) => existsSync(path));
}

export interface TestFailure {
  name: string;
  errorName: string;
}

export interface TestRunResult {
  collected: boolean;
  collectionError?: string;
  failures: TestFailure[];
}

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

export function runVitestReport(targets: string[], repoDir: string): { report: VitestJsonReport } | { error: string } {
  const config = targetVitestConfig(repoDir);
  if (!config) {
    return {
      error:
        `${repoDir} has no vitest config of its own, and vitest would climb out of it and run ` +
        `under whichever config sits above the checkout. Enrolment requires one; add it there.`,
    };
  }
  let stdout: string;
  try {
    stdout = execFileSync("npx", ["vitest", "run", "--config", config, "--root", repoDir, ...targets, "--reporter=json"], {
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

function errorNameOf(failureMessage: string | undefined): string {
  if (!failureMessage) return "Error";
  const match = /^([A-Za-z][\w.]*)(?::| )/.exec(failureMessage.trim());
  return match ? match[1] : "Error";
}

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
