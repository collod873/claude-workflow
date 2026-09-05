import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";

const STARTED = Date.now();

function logDir() {
  return process.env.STOP_GATE_LOG_DIR || join(homedir(), ".claude", "logs");
}

function localTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function callerStem() {
  const frame = (new Error().stack ?? "").split("\n")[3] ?? "";
  const match = frame.match(/(?:\()?(?:file:\/\/)?([^():\s]+):\d+:\d+\)?$/);
  return match ? basename(match[1]).replace(/\.[^./]+$/, "") : "unknown";
}

export function runRow(payload, verdict, extra = {}) {
  const cwd = payload && typeof payload.cwd === "string" ? payload.cwd : "";
  const row = {
    hook: callerStem(),
    event: (payload && payload.hook_event_name) || "",
    session_id: (payload && payload.session_id) || "",
    project: cwd ? cwd.split(sep).filter(Boolean).pop() || "" : "",
    verdict,
    seconds: Math.round((Date.now() - STARTED) / 100) / 10,
  };
  if (payload && payload.tool_use_id) row.tool_use_id = payload.tool_use_id;
  return { ...row, ...extra };
}

export function appendLog(row) {
  try {
    const dir = logDir();
    mkdirSync(dir, { recursive: true });
    const stamped = { ...row, ts: localTimestamp() };
    appendFileSync(join(dir, `${stamped.hook}-${stamped.ts.slice(0, 10)}.jsonl`), JSON.stringify(stamped) + "\n");
  } catch {
  }
}
