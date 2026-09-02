import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The out-of-process runner every acceptance fixture that calls real lane code shares.
 *
 * **Why any of this exists.** Everything under `tests/acceptance/` is restored from trunk before
 * CI runs it, and only this directory is — so a test that imported its subject would reach through
 * a specifier the branch under test controls, and the boundary lint rule refuses it. The subject
 * is reached the way a shell reaches it instead: a generated driver, run from the repository root,
 * importing the module by an absolute path built at runtime.
 *
 * **Why it is one function rather than one copy per fixture.** It was two — `238-reconcile-closer`
 * wrote it first and `346-dead-lanes` copied it — and the clone gate refused the second before it
 * ever landed. Two copies of a runner-selection ladder is two sets of divergent bugs about which
 * TypeScript runner this checkout has, which is exactly the question a fixture should never have
 * to answer twice.
 */

/** What one driver run needs to know. */
export interface DriverRun {
  /** The driver's source. Plain JavaScript in an `.mts` file, so it is ESM under every runner tried. */
  source: string;
  /** The line prefix the driver writes its JSON payload behind. */
  sentinel: string;
  /** Environment the driver reads its input from, merged over `process.env`. */
  env: Record<string, string>;
  /** Temp-directory prefix, so a failure names the fixture it came from. */
  prefix: string;
  /** What to say when no runner produced a payload. */
  failure: string;
}

/** One payload a driver emitted, before a caller narrows it. `error` is the driver's own catch. */
export interface DriverPayload {
  error?: string;
}

/**
 * Runs `source` out of process and returns the payload it emitted behind `sentinel`.
 *
 * Tries each runner in turn; the first that reports a clean payload wins, and the diagnostics of
 * the others are kept for the failure message. A payload carrying `error` is treated as a failed
 * attempt rather than a result, so a runner that loaded but threw does not mask one that would
 * have worked.
 */
export function runTsDriver<T extends DriverPayload>(run: DriverRun): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), run.prefix));
  const driver = path.join(dir, "driver.mts");
  writeFileSync(driver, run.source, "utf8");

  const env = { ...process.env, ...run.env };

  // Whichever of these this checkout can run a TypeScript entrypoint with.
  const attempts: Array<[string, string[]]> = [
    ["npx", ["--no-install", "tsx", driver]],
    ["node", ["--import", "tsx", driver]],
    ["node", [driver]],
  ];

  const diagnostics: string[] = [];
  for (const [command, args] of attempts) {
    let stdout = "";
    let stderr = "";
    try {
      stdout = execFileSync(command, args, {
        cwd: repoRoot,
        encoding: "utf8",
        env,
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const failure = err as { stdout?: string; stderr?: string; message?: string };
      stdout = failure.stdout ?? "";
      stderr = failure.stderr ?? failure.message ?? "";
    }

    const line = stdout.split("\n").find((candidate) => candidate.startsWith(run.sentinel));
    if (line === undefined) {
      diagnostics.push(command + " " + args.join(" ") + "\n" + stderr);
      continue;
    }
    const parsed = JSON.parse(line.slice(run.sentinel.length)) as T;
    if (parsed.error) {
      diagnostics.push(command + " " + args.join(" ") + "\n" + parsed.error);
      continue;
    }
    return parsed;
  }

  throw new Error(run.failure + ":\n" + diagnostics.join("\n---\n"));
}

/** The absolute path of a lane module, as a driver's `ACCEPTANCE_SUBJECT`. */
export function subjectPath(...segments: string[]): string {
  return path.join(repoRoot, ...segments);
}
