import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { execClaudeIn } from "./stage";

/** The real executor, in this process's own cwd — what every lane's workstation run gets. */
const execClaude = execClaudeIn();

/**
 * The real `execClaude`, driven against a stub `claude` on `PATH` — the half
 * of this seam no injected fake can stand in for, because what is under test
 * *is* the spawn: what the child's environment carries, and what happens to
 * the parent when the child is gone before the prompt is.
 *
 * Both cases below come from #134's to-tickets run. The prompt race is why
 * the suite went red inside that run's audit stage; the marker is why the
 * turn-end hook that read the red suite will not speak into a stage again.
 */

/** A stub `claude` first on `PATH`, running `body`, for the length of one test. */
function stubClaudeOnPath(body: string): void {
  const dir = mkdtempSync(join(tmpdir(), "exec-claude-"));
  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const stub = join(binDir, "claude");
  writeFileSync(stub, `#!/bin/bash\n${body}\n`, "utf8");
  chmodSync(stub, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  onTestFinished(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });
}

/** One `result` event, the only line `execClaude` reads anything out of. */
const resultEvent = (text: string) =>
  `printf '%s\\n' ${JSON.stringify(JSON.stringify({ type: "result", subtype: "success", result: text, num_turns: 1 }))}`;

/**
 * Larger than a pipe's 64 KiB buffer, so the parent is still writing when the
 * child exits. Below that the write fits in the buffer and lands whether or
 * not anything is there to read it, which is the version of this race that
 * passes on an idle machine and fails on a busy one.
 */
const PROMPT_PAST_THE_PIPE_BUFFER = "x".repeat(1024 * 1024);

describe("execClaude", () => {
  it("returns the response when the child answers and exits without reading its prompt", async () => {
    // The stub never touches stdin — the shape of every CLI stub in this suite, and of a real
    // `claude` that dies on a bad token. The parent's write then lands on a closed pipe as EPIPE,
    // and an unhandled `'error'` event on `stdin` would take this whole process down with it
    // rather than fail the stage.
    stubClaudeOnPath(resultEvent("answered anyway"));

    await expect(execClaude(["-p"], PROMPT_PAST_THE_PIPE_BUFFER)).resolves.toBe("answered anyway");
  });

  it("names the unwritten prompt when the child then produces nothing", async () => {
    stubClaudeOnPath("exit 0");

    await expect(execClaude(["-p"], PROMPT_PAST_THE_PIPE_BUFFER)).rejects.toThrow(
      /produced no result event \(the prompt never reached it: .*EPIPE/,
    );
  });

  it("marks the session as a stage, so this repo's own hooks stay out of it", async () => {
    stubClaudeOnPath(resultEvent("$WORKFLOW_STAGE"));

    await expect(execClaude(["-p", "a prompt on argv"])).resolves.toBe("1");
  });
});
