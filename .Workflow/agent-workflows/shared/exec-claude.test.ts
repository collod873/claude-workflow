import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { CLAUDE_STREAMS_DIR_ENV } from "./claude-streams";
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
      turns: 1,
      gauntletRuns: 0,
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
      turns: 1,
      gauntletRuns: 0,
    });
  });

  it("keeps every byte of the stream under the streams directory it is given", async () => {
    stubClaudeOnPath(`printf '%s\\n' '{"type":"system","subtype":"init"}'\n${resultEvent("kept")}`);
    const streams = mkdtempSync(join(tmpdir(), "claude-streams-"));
    process.env[CLAUDE_STREAMS_DIR_ENV] = streams;
    onTestFinished(() => {
      delete process.env[CLAUDE_STREAMS_DIR_ENV];
      rmSync(streams, { recursive: true, force: true });
    });

    await execClaude(["-p", "a prompt on argv"]);

    const kept = readdirSync(streams).map((file) => readFileSync(join(streams, file), "utf8"));
    expect(kept).toHaveLength(1);
    expect(kept[0].trim().split("\n").map((line) => JSON.parse(line).type)).toEqual(["system", "result"]);
  });

  it("asks the CLI for partial messages, so a long reply shows it is still writing", async () => {
    stubClaudeOnPath(resultEvent('"$*"'));

    await expect(execClaude(["-p", "a prompt on argv"])).resolves.toMatchObject({ text: expect.stringContaining("--include-partial-messages") });
  });

  it("resolves the session id the stream carried on its result event", async () => {
    stubClaudeOnPath(resultEvent("with a session", { session_id: "sess-abc" }));

    await expect(execClaude(["-p", "a prompt on argv"])).resolves.toEqual({
      text: "with a session",
      sessionId: "sess-abc",
      turns: 1,
      gauntletRuns: 0,
    });
  });
});
