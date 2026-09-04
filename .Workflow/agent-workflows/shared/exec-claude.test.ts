import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { execClaudeIn } from "./stage";

const execClaude = execClaudeIn();

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

const resultEvent = (text: string, extra: Record<string, unknown> = {}) =>
  `printf '%s\\n' ${JSON.stringify(JSON.stringify({ type: "result", subtype: "success", result: text, num_turns: 1, ...extra }))}`;

const PROMPT_PAST_THE_PIPE_BUFFER = "x".repeat(1024 * 1024);

describe("execClaude", () => {
  it("returns the response when the child answers and exits without reading its prompt", async () => {
    stubClaudeOnPath(resultEvent("answered anyway"));

    await expect(execClaude(["-p"], PROMPT_PAST_THE_PIPE_BUFFER)).resolves.toEqual({
      text: "answered anyway",
      sessionId: undefined,
    });
  });

  it("names the unwritten prompt when the child then produces nothing", async () => {
    stubClaudeOnPath("exit 0");

    await expect(execClaude(["-p"], PROMPT_PAST_THE_PIPE_BUFFER)).rejects.toThrow(
      /produced no result event \(the prompt never reached it: .*EPIPE/,
    );
  });

  it("marks the session as a stage, so this repo's own hooks stay out of it", async () => {
    stubClaudeOnPath(resultEvent("$WORKFLOW_STAGE"));

    await expect(execClaude(["-p", "a prompt on argv"])).resolves.toEqual({
      text: "1",
      sessionId: undefined,
    });
  });

  it("resolves the session id the stream carried on its result event", async () => {
    stubClaudeOnPath(resultEvent("with a session", { session_id: "sess-abc" }));

    await expect(execClaude(["-p", "a prompt on argv"])).resolves.toEqual({
      text: "with a session",
      sessionId: "sess-abc",
    });
  });
});
