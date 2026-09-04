import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { runStage, type StageExec } from "./stage";
import { createStreamJsonParser, progressLine } from "./stream-json";
import { structuredOutput } from "./structured-output";

function parse(chunks: string[]) {
  const progress: string[] = [];
  const parser = createStreamJsonParser((line) => progress.push(line));
  for (const chunk of chunks) parser.push(chunk);
  return { progress, ...parser.end() };
}

function resultEvent(result: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: "result", subtype: "success", result, ...extra });
}

describe("the final response text", () => {
  it("comes from the result event", () => {
    const { text, isError, missingResult } = parse([`${resultEvent("the answer")}\n`]);

    expect(text).toBe("the answer");
    expect(isError).toBe(false);
    expect(missingResult).toBe(false);
  });

  it("excludes the model's earlier turns, however much they said", () => {
    const thinking = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Here is my reasoning, at length." }] },
    });

    const { text } = parse([`${thinking}\n${resultEvent("the answer")}\n`]);

    expect(text).toBe("the answer");
  });

  it("prefers the result event's structured output over its result text", () => {
    const { text } = parse([
      `${resultEvent("ignored prose", { structured_output: { entries: ["a seam"] } })}\n`,
    ]);

    expect(JSON.parse(text)).toEqual({ entries: ["a seam"] });
  });

  it("falls back to the result text when the run carried no structured output", () => {
    const { text } = parse([`${resultEvent("the model just talked")}\n`]);

    expect(text).toBe("the model just talked");
  });

  it("treats a null structured output as absent rather than as the value null", () => {
    const { text } = parse([`${resultEvent("the prose", { structured_output: null })}\n`]);

    expect(text).toBe("the prose");
  });

  it("reports a stream that carried no result event, rather than returning empty text as success", () => {
    const { text, missingResult } = parse(['{"type":"system","subtype":"init"}\n']);

    expect(text).toBe("");
    expect(missingResult).toBe(true);
  });

  it("reports a result the CLI itself marked as an error", () => {
    const { isError } = parse([`${resultEvent("", { is_error: true })}\n`]);

    expect(isError).toBe(true);
  });

  it("reports an error subtype even when is_error is absent", () => {
    const errored = JSON.stringify({ type: "result", subtype: "error_max_turns", result: "" });

    expect(parse([`${errored}\n`]).isError).toBe(true);
  });
});

describe("the session id", () => {
  it("is reported from the init event", () => {
    const init = JSON.stringify({ type: "system", subtype: "init", session_id: "sess-init" });

    const { sessionId } = parse([`${init}\n${resultEvent("done")}\n`]);

    expect(sessionId).toBe("sess-init");
  });

  it("is reported from the result event", () => {
    const { sessionId } = parse([`${resultEvent("done", { session_id: "sess-result" })}\n`]);

    expect(sessionId).toBe("sess-result");
  });

  it("is undefined when no event carried one", () => {
    const { sessionId } = parse([`${resultEvent("done")}\n`]);

    expect(sessionId).toBeUndefined();
  });
});

describe("chunk boundaries", () => {
  it("reassembles an event split across two chunks", () => {
    const event = resultEvent('{"entries":[]}');
    const split = Math.floor(event.length / 2);

    const { text } = parse([event.slice(0, split), `${event.slice(split)}\n`]);

    expect(text).toBe('{"entries":[]}');
  });

  it("reassembles an event split one byte at a time", () => {
    const event = `${resultEvent("split fine")}\n`;

    expect(parse([...event]).text).toBe("split fine");
  });

  it("parses a final line that never got its newline", () => {
    expect(parse([resultEvent("no trailing newline")]).text).toBe("no trailing newline");
  });

  it("handles several events arriving in one chunk", () => {
    const chunk = `{"type":"system","subtype":"init"}\n${resultEvent("both")}\n`;

    expect(parse([chunk]).text).toBe("both");
  });

  it("ignores blank lines between events", () => {
    expect(parse([`\n\n${resultEvent("still here")}\n\n`]).text).toBe("still here");
  });
});

describe("noise on stdout", () => {
  it("narrates a non-JSON line instead of throwing, and still finds the result", () => {
    const { progress, text } = parse([`npm notice: a new version is available\n${resultEvent("ok")}\n`]);

    expect(progress).toContain("npm notice: a new version is available");
    expect(text).toBe("ok");
  });
});

describe("progress lines", () => {
  it("names the tool and its path for a tool call", () => {
    const line = progressLine({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: { file_path: "prompt.md" } }],
      },
    });

    expect(line).toBe("→ Read(prompt.md)");
  });

  it("gives one line per content block of a turn", () => {
    const line = progressLine({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading the spec." },
          { type: "tool_use", name: "Grep", input: { pattern: "StageExec" } },
        ],
      },
    });

    expect(line).toBe("  Reading the spec.\n→ Grep(StageExec)");
  });

  it("keeps only the first line of a turn's prose", () => {
    const line = progressLine({
      type: "assistant",
      message: { content: [{ type: "text", text: "First line.\nSecond line.\nThird." }] },
    });

    expect(line).toBe("  First line.");
  });

  it("truncates prose long enough to bury the next line", () => {
    const line = progressLine({
      type: "assistant",
      message: { content: [{ type: "text", text: "x".repeat(500) }] },
    });

    expect(line?.length).toBeLessThan(200);
    expect(line?.endsWith("…")).toBe(true);
  });

  it("says nothing for the user event echoing a tool result", () => {
    const line = progressLine({
      type: "user",
      message: { content: [{ type: "tool_result", content: "a whole file".repeat(1000) }] },
    });

    expect(line).toBeNull();
  });

  it("still names a tool whose input has no argument worth printing", () => {
    const line = progressLine({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Task", input: {} }] },
    });

    expect(line).toBe("→ Task()");
  });

  it("closes with the duration and turn count, which is what a slow stage is judged on", () => {
    const line = progressLine({
      type: "result",
      subtype: "success",
      result: "",
      duration_ms: 153_400,
      num_turns: 12,
    });

    expect(line).toBe("· done in 153.4s, 12 turns");
  });

  it("says a run failed when the result event is an error", () => {
    const line = progressLine({ type: "result", subtype: "success", result: "", is_error: true });

    expect(line).toBe("· failed");
  });

  it("says nothing for an event type it does not render", () => {
    expect(progressLine({ type: "stream_event" })).toBeNull();
    expect(progressLine("not an object")).toBeNull();
    expect(progressLine(null)).toBeNull();
  });
});

describe("a stage's answer, from the CLI's bytes to a typed value", () => {
  const OUTPUT = structuredOutput(z.object({ entries: z.array(z.string()) }));

  function execOverStream(chunks: string[]): StageExec {
    return async () => {
      const parser = createStreamJsonParser(() => undefined);
      for (const chunk of chunks) parser.push(chunk);
      return parser.end().text;
    };
  }

  it("returns the parsed value from a result event carrying structured output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stream-json-stage-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const promptPath = join(dir, "prompt.md");
    writeFileSync(promptPath, "Sweep for seams.", "utf8");

    const stream = [
      JSON.stringify({ type: "system", subtype: "init", model: "stub" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Two seams worth sharing." }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: '{"entries":["a seam","another seam"]}',
        structured_output: { entries: ["a seam", "another seam"] },
        num_turns: 3,
      }),
    ].join("\n") + "\n";

    expect(stream).not.toContain("<output>");

    await expect(
      runStage(promptPath, {}, execOverStream([stream]), OUTPUT, { stage: "test" }),
    ).resolves.toEqual({
      entries: ["a seam", "another seam"],
    });
  });
});
