/**
 * The `claude --output-format stream-json` wire format, turned into two
 * things a stage actually wants: a line of human-readable progress per
 * event, and the model's final response text.
 *
 * This is a module rather than a few lines inside `execClaude` because the
 * two things most likely to break here are both awkward to reach through a
 * spawned subprocess: a JSON object split across two stdout chunks, and a
 * response reassembled from the wrong field. Both are ordinary function
 * calls from a test when the parser is its own seam, and neither is
 * reachable at all when it lives inside the spawn.
 */

/**
 * The one event that carries the model's answer. Everything else in the
 * stream is progress — narration this parser renders and then discards.
 *
 * The answer is read from the `result` event rather than accumulated from
 * the `assistant` text blocks along the way, because those blocks are every
 * turn the model took, not its answer: a stage that thinks out loud before
 * answering would have that thinking concatenated into whatever parses the
 * response next.
 */
const RESULT_EVENT = "result";

/**
 * The result event's already-validated structured output, when the run was
 * given a `--json-schema`. The CLI reports the same value twice — as an
 * object here and as a JSON string in `result` — and this is the one taken.
 *
 * Preferred rather than treated as equivalent because the two fields answer
 * different questions. `result` is *whatever the run produced*: for a run
 * whose model never reached the `StructuredOutput` tool it is the model's
 * prose, which parses as nothing and would reach the stage as a `SyntaxError`
 * about position 0. `structured_output` is present only when a validated
 * value exists, so re-serialising it is how a stage gets the value the API
 * checked rather than the text the CLI happened to print.
 */
const STRUCTURED_FIELD = "structured_output";

/** What `end()` reports back once the stream is closed. */
export interface StreamResult {
  /** The model's final response text — `""` if the stream carried no result event. */
  text: string;
  /**
   * Whether the CLI itself reported the run as failed (`is_error`, or an
   * error `subtype`). Distinct from a nonzero exit code, which the caller
   * checks separately: a stream can end with an error result *and* exit 0.
   */
  isError: boolean;
  /** True when no result event was seen at all — a truncated or non-stream-json stream. */
  missingResult: boolean;
}

export interface StreamJsonParser {
  /** Feeds one stdout chunk. Chunk boundaries need not align with lines. */
  push(chunk: string): void;
  /** Closes the stream, flushing any trailing partial line, and reports the result. */
  end(): StreamResult;
}

/**
 * Builds a parser that calls `onProgress` once per renderable event and
 * holds on to the final result.
 *
 * Unparseable lines are handed to `onProgress` verbatim rather than thrown
 * on. The CLI is not the only thing that can write to stdout — a wrapper
 * script, a deprecation notice, an npm warning — and a stage that died
 * because something printed a banner ahead of the stream would be a worse
 * failure than the banner. A stream that genuinely never carried a result
 * is reported through `missingResult` instead, where the caller can say so
 * in terms of the stage that ran.
 */
export function createStreamJsonParser(onProgress: (line: string) => void): StreamJsonParser {
  let pending = "";
  let text = "";
  let isError = false;
  let sawResult = false;

  function consume(line: string): void {
    const trimmed = line.trim();
    if (trimmed === "") return;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      onProgress(trimmed);
      return;
    }

    if (isRecord(event) && event.type === RESULT_EVENT) {
      sawResult = true;
      text = finalText(event);
      isError = event.is_error === true || String(event.subtype ?? "").startsWith("error");
    }

    const line_ = progressLine(event);
    if (line_ !== null) onProgress(line_);
  }

  return {
    push(chunk) {
      pending += chunk;
      // The final segment is whatever followed the last newline — a partial
      // line if the chunk cut one in half, or "" if it ended cleanly. Either
      // way it is held back for the next chunk rather than parsed now.
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) consume(line);
    },
    end() {
      if (pending !== "") {
        consume(pending);
        pending = "";
      }
      return { text, isError, missingResult: !sawResult };
    },
  };
}

/**
 * The answer carried by one result event: its structured output re-serialised
 * when the run had a schema, and its `result` text otherwise.
 *
 * `null` is not a structured output — `JSON.stringify(null)` is the string
 * `"null"`, which parses, satisfies nothing, and would report a stage's
 * missing answer as a schema failure rather than as an absent one.
 */
function finalText(event: Record<string, unknown>): string {
  const structured = event[STRUCTURED_FIELD];
  if (structured !== undefined && structured !== null) {
    return JSON.stringify(structured);
  }
  return typeof event.result === "string" ? event.result : "";
}

/**
 * One line of progress for one event, or `null` for events with nothing
 * worth a line (the `user` echo of a tool result, whose content is the tool
 * output itself — often an entire file, which is exactly the firehose this
 * whole exercise is meant to avoid printing).
 */
export function progressLine(event: unknown): string | null {
  if (!isRecord(event)) return null;

  switch (event.type) {
    case "system":
      return event.subtype === "init" ? `· session started${modelSuffix(event)}` : null;

    case "assistant":
      return assistantLine(event);

    case RESULT_EVENT: {
      const turns = typeof event.num_turns === "number" ? `, ${event.num_turns} turns` : "";
      const cost =
        typeof event.total_cost_usd === "number" ? `, $${event.total_cost_usd.toFixed(4)}` : "";
      const outcome = event.is_error === true ? "failed" : "done";
      return `· ${outcome}${durationSuffix(event)}${turns}${cost}`;
    }

    default:
      return null;
  }
}

/**
 * A line per content block of one assistant turn: `→ Tool(arg)` for a tool
 * call, the first line of the prose for text. Both are truncated — the
 * point of this log is to show *where* a stage is, and a stage that pastes
 * a whole file into its reasoning should cost one line here, not a screen.
 */
function assistantLine(event: Record<string, unknown>): string | null {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return null;

  const lines: string[] = [];
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    if (block.type === "tool_use") {
      lines.push(`→ ${String(block.name ?? "tool")}(${toolArg(block.input)})`);
    } else if (block.type === "text" && typeof block.text === "string") {
      const first = block.text.trim().split("\n")[0];
      if (first) lines.push(`  ${truncate(first, 160)}`);
    }
  }
  return lines.length === 0 ? null : lines.join("\n");
}

/**
 * The one argument worth naming in a tool-call line, picked by convention
 * over the shapes this repo's stages actually call: a path, a command, a
 * pattern. Anything else prints nothing rather than guessing — an unlabelled
 * `→ Task()` still says a tool ran and how long it took.
 */
function toolArg(input: unknown): string {
  if (!isRecord(input)) return "";
  for (const key of ["file_path", "path", "command", "pattern", "url", "description"]) {
    const value = input[key];
    if (typeof value === "string" && value !== "") return truncate(value.split("\n")[0], 80);
  }
  return "";
}

function modelSuffix(event: Record<string, unknown>): string {
  return typeof event.model === "string" ? ` (${event.model})` : "";
}

function durationSuffix(event: Record<string, unknown>): string {
  const ms = event.duration_ms;
  return typeof ms === "number" ? ` in ${(ms / 1000).toFixed(1)}s` : "";
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
