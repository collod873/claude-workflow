#!/usr/bin/env node

import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STARTED = performance.now();

export const LOG_DIR = process.env.STOP_GATE_LOG_DIR || join(homedir(), ".claude", "logs");
export const LOG_RETENTION_DAYS = 30;

function stem(path) {
  return basename(path, extname(path));
}

function callerStem() {
  const path = process.argv[1];
  if (!path) return "_hook";
  try {
    return stem(realpathSync(path));
  } catch {
    return stem(path);
  }
}

export const HOOK_NAME = callerStem();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readPayload() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return [{}, false];
  }
  if (!isObject(payload)) return [{}, false];
  if (!isObject(payload.tool_input)) payload.tool_input = {};
  return [payload, true];
}

export function runRow(payload, verdict, extra = {}) {
  const p = isObject(payload) ? payload : {};
  const row = {
    hook: HOOK_NAME,
    event: p.hook_event_name || "",
    session_id: p.session_id || "",
    project: typeof p.cwd === "string" && p.cwd ? basename(p.cwd) : "",
    verdict,
    seconds: Math.round((performance.now() - STARTED) * 10) / 10000,
  };
  if (typeof p.tool_use_id === "string" && p.tool_use_id) row.tool_use_id = p.tool_use_id;
  return Object.assign(row, extra);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTimestamp(d) {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pruneOldLogs(hook) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOG_RETENTION_DAYS);
  let names;
  try {
    names = readdirSync(LOG_DIR);
  } catch {
    return;
  }
  const dated = new RegExp(`^${hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{4})-(\\d{2})-(\\d{2})\\.jsonl$`);
  for (const name of names) {
    const m = dated.exec(name);
    if (!m) continue;
    const when = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(when.getTime()) || when >= cutoff) continue;
    try {
      unlinkSync(join(LOG_DIR, name));
    } catch {
      continue;
    }
  }
}

export function appendLog(row) {
  const out = { ...row };
  const now = new Date();
  if (out.ts === undefined) out.ts = localTimestamp(now);
  const hook = typeof out.hook === "string" && out.hook ? out.hook : HOOK_NAME;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, `${hook}-${localDate(now)}.jsonl`), JSON.stringify(out) + "\n");
  } catch {
    return;
  }
  pruneOldLogs(hook);
}

function parseExtra(args) {
  const extra = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq <= 0) continue;
    const key = arg.slice(0, eq);
    const raw = arg.slice(eq + 1);
    try {
      extra[key] = JSON.parse(raw);
    } catch {
      extra[key] = raw;
    }
  }
  return extra;
}

function main(argv) {
  let hook = null;
  let started = null;
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--hook") hook = argv[++i];
    else if (argv[i] === "--started") started = Number(argv[++i]);
    else rest.push(argv[i]);
  }
  const [verdict = "", ...extras] = rest;
  const [payload] = readPayload();
  const row = runRow(payload, verdict);
  if (hook) row.hook = hook;
  if (Number.isFinite(started) && started > 0) row.seconds = Math.round((Date.now() - started) * 10) / 10000;
  appendLog(Object.assign(row, parseExtra(extras)));
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) main(process.argv.slice(2));
