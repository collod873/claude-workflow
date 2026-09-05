#!/usr/bin/env node
// The run-row writer for a hook written in JavaScript: the same row `_hook.py`'s
// `run_row()` + `append_log()` write, spelled once per language (#210).
//
// `_hook.py` is the original. This file exists because a Node repo's hooks run on a
// runner with no Python, so a JS hook shelling to the Python writer would be a hook
// whose rows silently stop on CI; and because before this each such repo carried a
// private re-spelling of the row (Workflow's `logRow`, Lumaria's tab-separated
// `hook-log.mjs`) that drifted from the Python one every time the shape moved
// (`tool_use_id`, `chars`). `hooks/test__hook_writers.py` drives this file, `_hook.py`
// and `_hook.sh` with one payload and diffs the rows, so a field added to one writer
// without the others fails a test rather than going invisible to `bin/hook-report`.
//
// Two ways in:
//
//   import { readPayload, runRow, appendLog } from "./_hook.mjs";
//   const [payload, ok] = readPayload();
//   appendLog(runRow(payload, ok ? "allow" : "bad-stdin", { slug: "x" }));
//
// or, from a shell (what `_hook.sh` does, so JSON is parsed in one place):
//
//   printf '%s' "$payload" | node _hook.mjs --hook <name> --started <epoch-ms> <verdict> [key=value ...]
//
// The row: `hook` (this process's own script stem, `.resolve()`d through the
// `~/.claude/hooks/` symlink the way `_hook.py`'s `HOOK_NAME` is), `event`,
// `session_id`, `project` (basename of the payload's `cwd`), `verdict`, `seconds`
// (wall time since this module loaded, 4 dp), `tool_use_id` only when the payload
// carries one (#205: Stop does not, and an always-present empty field would make
// "no id" and "an id nothing matched" indistinguishable to `bin/hook-trace`), then
// `extra`, which may override any stamped field. `ts` is `appendLog`'s to stamp:
// local time at seconds precision, the one format every row on this machine shares.
//
// Target is `$STOP_GATE_LOG_DIR/<hook>-YYYY-MM-DD.jsonl`, default `~/.claude/logs/`;
// mkdir handled, older siblings pruned at `LOG_RETENTION_DAYS`, every error swallowed,
// so a verdict never depends on a writable log (ADR-0005's observability rule).
//
// A consuming repo carries a byte-identical copy at `.claude/hooks/lib/_hook.mjs`;
// `bin/re-seed` reports when it drifts. Nothing here reads a path relative to a repo,
// which is what lets one file be copied between layouts unedited.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Wall clock starts when this module is evaluated, which is the first import of every
// JS hook and the closest thing to "when the process began reading stdin" a module can
// observe; `runRow`'s `seconds` is measured from here so a hook cannot forget a timer.
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

// [payload, ok]: stdin parsed as JSON, `tool_input` normalised to an object. `ok` is
// false on no stdin, bad JSON, or a top-level value that is not an object, and the
// payload is then `{}`, so a caller that ignores `ok` still holds something it can
// read fields off safely and still owes a row (`_hook.py`'s `read_payload()`).
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
      // best effort, same as the write below
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

// --- CLI: the shell shim's door ---------------------------------------------------

// A `key=value` extra from the shell is typed the way a JSON literal would be
// (`chars=12` is a number, `hits={"a":1}` an object, `slug=x` a string), so a bash
// hook can carry the same fields a Python one passes as keyword arguments.
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
