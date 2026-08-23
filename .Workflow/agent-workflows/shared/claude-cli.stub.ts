import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A stub `claude` binary, placed first on `PATH`, that prints `stdout`
 * verbatim in place of the model — for a test that exercises a stage's real
 * CLI end to end (argv, extraction, schema, handoff write, exit code)
 * without spawning one.
 *
 * Takes `dir` rather than creating one, so its lifetime is the caller's to
 * own — typically `withHandoffDir()`. When `priorHandoff` is given, it is
 * seeded at the handoff path before the stub runs, for a stage (like
 * `slice`) that reads a prior stage's handoff as its own input.
 */
export function stubClaudeCli(
  dir: string,
  stdout: string,
  priorHandoff?: string,
): { env: NodeJS.ProcessEnv; handoffFile: string } {
  const outputFile = join(dir, "stub-output.txt");
  writeFileSync(outputFile, stdout, "utf8");

  const stubDir = join(dir, "bin");
  mkdirSync(stubDir);
  const stubPath = join(stubDir, "claude");
  writeFileSync(stubPath, `#!/usr/bin/env bash\ncat "${outputFile}"\n`, "utf8");
  chmodSync(stubPath, 0o755);

  const handoffFile = join(dir, "handoff.txt");
  if (priorHandoff !== undefined) {
    writeFileSync(handoffFile, priorHandoff, "utf8");
  }

  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH ?? ""}`,
    FAILURE_REASON_PATH: handoffFile,
  };
  return { env, handoffFile };
}
