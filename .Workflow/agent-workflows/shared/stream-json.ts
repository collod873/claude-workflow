const RESULT_EVENT = "result";

const STRUCTURED_FIELD = "structured_output";

export interface StreamResult {
  text: string;
  isError: boolean;
  missingResult: boolean;
}

export interface StreamJsonParser {
  push(chunk: string): void;
  end(): StreamResult;
}

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

function finalText(event: Record<string, unknown>): string {
  const structured = event[STRUCTURED_FIELD];
  if (structured !== undefined && structured !== null) {
    return JSON.stringify(structured);
  }
  return typeof event.result === "string" ? event.result : "";
}

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
