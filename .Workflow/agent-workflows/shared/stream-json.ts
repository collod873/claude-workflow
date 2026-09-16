const RESULT_EVENT = "result";

const STRUCTURED_FIELD = "structured_output";

export interface StreamResult {
  text: string;
  isError: boolean;
  missingResult: boolean;
  sessionId?: string;
  turns?: number;
  gauntletRuns: number;
}

export interface StreamJsonParser {
  push(chunk: string): void;
  pulse(startedAt: number): string;
  end(): StreamResult;
}

export function createStreamJsonParser(onProgress: (line: string) => void, clock: () => number = Date.now): StreamJsonParser {
  let pending = "";
  let text = "";
  let isError = false;
  let sawResult = false;
  let sessionId: string | undefined;
  let turns: number | undefined;
  let gauntletRuns = 0;
  let events = 0;
  let written = 0;
  let lastEventAt: number | undefined;

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

    events += 1;
    lastEventAt = clock();
    written += deltaLength(event);

    if (isRecord(event) && event.type === RESULT_EVENT) {
      sawResult = true;
      text = finalText(event);
      isError = event.is_error === true || String(event.subtype ?? "").startsWith("error");
      if (typeof event.num_turns === "number") turns = event.num_turns;
    }

    if (isRecord(event) && event.type === "assistant") {
      gauntletRuns += countGauntletRuns(event);
    }

    if (isRecord(event) && typeof event.session_id === "string" && event.session_id !== "") {
      sessionId = event.session_id;
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
    pulse(startedAt) {
      const now = clock();
      const running = `· still running after ${minutesAndSeconds(now - startedAt)}`;
      if (lastEventAt === undefined) return `${running}: no stream events yet`;
      return `${running}: ${events} stream events, ${written.toLocaleString("en-US")} characters, last event ${minutesAndSeconds(now - lastEventAt)} ago`;
    },
    end() {
      if (pending !== "") {
        consume(pending);
        pending = "";
      }
      return { text, isError, missingResult: !sawResult, sessionId, turns, gauntletRuns };
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
      if (event.subtype === "init") return `· session started${modelSuffix(event)}`;
      return event.subtype === "api_retry" ? retryLine(event) : null;

    case "rate_limit_event":
      return rateLimitLine(event.rate_limit_info);

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

function retryLine(event: Record<string, unknown>): string {
  const delay = typeof event.retry_delay_ms === "number" ? ` in ${(event.retry_delay_ms / 1000).toFixed(1)}s` : "";
  const status = typeof event.error_status === "number" ? ` (${event.error_status})` : "";
  return `· API retry ${String(event.attempt)}/${String(event.max_retries)}${delay}: ${String(event.error)}${status}`;
}

function rateLimitLine(info: unknown): string | null {
  if (!isRecord(info) || info.status === "allowed") return null;
  return `· rate limit ${String(info.status)} (${String(info.rateLimitType)})`;
}

function deltaLength(event: unknown): number {
  if (!isRecord(event) || event.type !== "stream_event" || !isRecord(event.event) || !isRecord(event.event.delta)) return 0;
  const delta = event.event.delta;
  const written = delta.text ?? delta.thinking ?? delta.partial_json;
  return typeof written === "string" ? written.length : 0;
}

function minutesAndSeconds(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function assistantBlocks(event: Record<string, unknown>): Record<string, unknown>[] {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord);
}

function assistantLine(event: Record<string, unknown>): string | null {
  const lines: string[] = [];
  for (const block of assistantBlocks(event)) {
    if (block.type === "tool_use") {
      lines.push(`→ ${String(block.name ?? "tool")}(${toolArg(block.input)})`);
    } else if (block.type === "text" && typeof block.text === "string") {
      const first = block.text.trim().split("\n")[0];
      if (first) lines.push(`  ${truncate(first, 160)}`);
    }
  }
  return lines.length === 0 ? null : lines.join("\n");
}

function countGauntletRuns(event: Record<string, unknown>): number {
  return assistantBlocks(event).filter(
    (block) => block.type === "tool_use" && block.name === "Bash" && isGauntletCommand(block.input),
  ).length;
}

function isGauntletCommand(input: unknown): boolean {
  return isRecord(input) && typeof input.command === "string" && input.command.includes("bin/gauntlet");
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
