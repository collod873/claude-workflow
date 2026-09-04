import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkpointPath } from "./stage";

/**
 * @fixture A `claude` on a test's path answering from a file, so a stage test spends no model call.
 */

export type StubAnswer = string | { structured: unknown };

export function stubClaudeCli(
  dir: string,
  answer: StubAnswer,
  priorCheckpoint?: { stage: string; response: string },
): { env: NodeJS.ProcessEnv; handoffFile: string } {
  const result =
    typeof answer === "string"
      ? { result: answer }
      : { result: JSON.stringify(answer.structured), structured_output: answer.structured };
  const stream =
    [
      JSON.stringify({ type: "system", subtype: "init", model: "stub" }),
      JSON.stringify({ type: "result", subtype: "success", ...result, num_turns: 1 }),
    ].join("\n") + "\n";

  const outputFile = join(dir, "stub-output.txt");
  writeFileSync(outputFile, stream, "utf8");

  const stubDir = join(dir, "bin");
  mkdirSync(stubDir);
  const stubPath = join(stubDir, "claude");
  writeFileSync(stubPath, `#!/usr/bin/env bash\ncat "${outputFile}"\n`, "utf8");
  chmodSync(stubPath, 0o755);

  const handoffFile = join(dir, "handoff.txt");

  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH ?? ""}`,
    FAILURE_REASON_PATH: handoffFile,
  };

  if (priorCheckpoint !== undefined) {
    const path = checkpointPath(priorCheckpoint.stage);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ key: "stub", response: priorCheckpoint.response }), "utf8");
  }

  return { env, handoffFile };
}
