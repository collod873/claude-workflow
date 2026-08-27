import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the stub `claude` answers with.
 *
 * A string is **prose**: the run produced no structured output at all, which
 * is what a real result event looks like when the model never reached the
 * `StructuredOutput` tool. Anything else is the validated value, delivered
 * the way the real CLI delivers it — on `structured_output` as an object and
 * on `result` as the same JSON, serialised.
 */
export type StubAnswer = string | { structured: unknown };

/**
 * A stub `claude` binary, placed first on `PATH`, that delivers `answer`
 * as the model's answer — for a test that exercises a stage's real CLI end
 * to end (argv, schema, handoff write, exit code) without spawning one.
 *
 * It emits the `stream-json` events `execClaude` reads rather than printing
 * the response verbatim, because that is the wire format the real CLI is
 * now asked for (see `STREAM_FLAGS` in `./stage`). A stub that still
 * printed bare text would be testing these stages against a `claude` that
 * no longer exists — every response would reach the parser as unparseable
 * noise with no result event behind it.
 *
 * Takes `dir` rather than creating one, so its lifetime is the caller's to
 * own — typically `withHandoffDir()`. When `priorHandoff` is given, it is
 * seeded at the handoff path before the stub runs, for a stage (like
 * `slice`) that reads a prior stage's handoff as its own input.
 */
export function stubClaudeCli(
  dir: string,
  answer: StubAnswer,
  priorHandoff?: string,
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
