import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

const STARTED = Date.now();

function logDir() {
  return process.env.STOP_GATE_LOG_DIR || join(homedir(), ".claude", "logs");
}

function localTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function runRow(hook, payload, verdict, extra = {}) {
  const cwd = payload && typeof payload.cwd === "string" ? payload.cwd : "";
  return {
    hook,
    event: (payload && payload.hook_event_name) || "",
    session_id: (payload && payload.session_id) || "",
    project: cwd ? cwd.split(sep).filter(Boolean).pop() || "" : "",
    verdict,
    seconds: Math.round((Date.now() - STARTED) / 100) / 10,
    ...extra,
    ts: localTimestamp(),
  };
}

export function appendLog(hook, row) {
  try {
    const dir = logDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${hook}-${row.ts.slice(0, 10)}.jsonl`), JSON.stringify(row) + "\n");
  } catch {
  }
}
