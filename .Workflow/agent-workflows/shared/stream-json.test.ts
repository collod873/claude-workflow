import { describe, expect, it } from "vitest";
import { createStreamJsonParser, progressLine } from "./stream-json";

/**
 * Feeds `chunks` to a parser and returns both halves of what it produces —
 * the progress lines it narrated and the result it held on to. Every test
 * here drives the parser by pushing strings, which is the point of it being
 * its own module: the chunk boundary is the interesting variable, and a
 * spawned subprocess gives no way to choose one.
 */
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
    const { text, isError, missingResult } = parse([`${resultEvent("<output>[]</output>")}\n`]);

    expect(text).toBe("<output>[]</output>");
    expect(isError).toBe(false);
    expect(missingResult).toBe(false);
  });

  /**
   * The reason the result event is the source rather than the assistant
   * turns: ADR-0012 makes the outermost `<output>` span the payload, so a
   * stage's earlier thinking is not a harmless prefix — this response would
   * parse as a block running from the model's musing to the real closing
   * tag, and `JSON.parse` would see the whole thing.
   */
  it("excludes the model's earlier turns, even when those mention the output tag", () => {
    const thinking = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "I will end with an <output> block." }] },
    });

    const { text } = parse([`${thinking}\n${resultEvent('<output>["a seam"]</output>')}\n`]);

    expect(text).toBe('<output>["a seam"]</output>');
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

describe("chunk boundaries", () => {
  /**
   * The failure this module exists to make testable: stdout arrives in
   * whatever sizes the OS hands over, and a parser that assumed a chunk was
   * a whole line would drop the response of any stage whose result event
   * happened to straddle one.
   */
  it("reassembles an event split across two chunks", () => {
    const event = resultEvent("<output>[]</output>");
    const split = Math.floor(event.length / 2);

    const { text } = parse([event.slice(0, split), `${event.slice(split)}\n`]);

    expect(text).toBe("<output>[]</output>");
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
  /**
   * A wrapper script's banner or an npm notice ahead of the stream is not a
   * reason to fail a stage that then ran fine. Unparseable lines are
   * narrated and dropped.
   */
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

  /**
   * A tool result is the tool's entire output — often a whole file. Printing
   * it would recreate the firehose this change exists to avoid.
   */
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
