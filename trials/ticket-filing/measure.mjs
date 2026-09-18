import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECTS = "/home/collin/.claude/projects/-home-collin-Claude-Projects-Workflow";
const RUNS = join(import.meta.dirname, "runs");

const SLICES = {
  603: {
    sessions: [{ id: "ca7a2c5c-ae56-44e4-8fcc-87d7ab02e039", from: "Ok so 602 and 601 have landed", to: /file-issue ticket --title "The blocked-by graph/ }],
    covers: ["603"],
  },
  586: {
    sessions: [
      { id: "0c62c7f3-452a-4b6a-a8ed-7246a8582ef7", from: null, to: null },
      { id: "4af6f9ae-0624-450d-9969-494415c0b36c", from: "GH 584, 585, 586, 587", to: /file-issue ticketify|S=.*scratch/ },
    ],
    covers: ["584", "585", "586", "587"],
  },
};

function entries(id) {
  return readFileSync(join(PROJECTS, `${id}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

function spoken(entry) {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

function toolsIn(entry) {
  const content = entry.message?.content;
  return Array.isArray(content) ? content.filter((block) => block.type === "tool_use") : [];
}

function bounds(all, { from, to }) {
  const start = from === null ? 0 : all.findIndex((entry) => entry.type === "user" && !entry.isMeta && spoken(entry).trim().startsWith(from));
  let end = all.length - 1;
  if (to !== null) {
    const found = all.findIndex((entry, index) => index > start && entry.type === "assistant" && toolsIn(entry).some((block) => to.test(JSON.stringify(block.input))));
    if (found !== -1) end = found;
  }
  return [start === -1 ? 0 : start, end];
}

function sliceOf(id, span) {
  const all = entries(id);
  const [start, end] = bounds(all, span);
  const kept = all.slice(start, end + 1);
  const stamps = kept.filter((entry) => entry.timestamp).map((entry) => new Date(entry.timestamp).getTime());
  const usage = kept.filter((entry) => entry.type === "assistant" && entry.message?.usage).map((entry) => entry.message.usage);
  const tools = kept.flatMap(toolsIn).map((block) => block.name);
  const firstWrite = tools.findIndex((name) => name === "Write" || name === "Edit");
  const state = all.find((entry) => entry.type === "cost-state");
  return {
    id: id.slice(0, 8),
    entries: kept.length,
    ownerClockMin: stamps.length === 0 ? null : Number(((Math.max(...stamps) - Math.min(...stamps)) / 60000).toFixed(1)),
    inputTokens: usage.reduce((sum, u) => sum + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), 0),
    outputTokens: usage.reduce((sum, u) => sum + (u.output_tokens ?? 0), 0),
    toolCalls: tools.length,
    toolCallsBeforeFirstWrite: firstWrite === -1 ? null : firstWrite,
    sessionTotalCostUsd: state === undefined ? null : Number(state.totalCostUSD.toFixed(2)),
    sessionWallMin: state === undefined ? null : Number((state.totalDuration / 60000).toFixed(1)),
  };
}

function liveOf(subject) {
  const at = join(RUNS, `live-${subject}`);
  if (!existsSync(join(at, "record.json"))) return null;
  const record = JSON.parse(readFileSync(join(at, "record.json"), "utf8"));
  const stream = existsSync(join(at, "stream.jsonl")) ? readFileSync(join(at, "stream.jsonl"), "utf8") : "";
  const tools = [];
  for (const line of stream.split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed.type === "assistant") for (const block of parsed.message?.content ?? []) if (block.type === "tool_use") tools.push(block.name);
  }
  const firstWrite = tools.findIndex((name) => name === "Write" || name === "Edit");
  return { ...record, toolCallsBeforeFirstWrite: firstWrite === -1 ? null : firstWrite };
}

function briefBytes(ticket) {
  const run = spawnSync("core/bin/brief", [String(ticket)], { encoding: "utf8", cwd: join(import.meta.dirname, "..", "..") });
  const said = /is (\d+) bytes/.exec(run.stdout ?? "");
  return run.status === 0 && said !== null ? Number(said[1]) : null;
}

const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const subjects = wanted.length > 0 ? wanted : Object.keys(SLICES);
const report = {};

for (const subject of subjects) {
  const slice = SLICES[subject];
  const historical = slice.sessions.map(({ id, ...span }) => sliceOf(id, span));
  const live = liveOf(subject);
  report[subject] = {
    historical: {
      sessions: historical,
      ownerClockMin: Number(historical.reduce((sum, s) => sum + (s.ownerClockMin ?? 0), 0).toFixed(1)),
      inputTokens: historical.reduce((sum, s) => sum + s.inputTokens, 0),
      outputTokens: historical.reduce((sum, s) => sum + s.outputTokens, 0),
      toolCalls: historical.reduce((sum, s) => sum + s.toolCalls, 0),
      covers: slice.covers,
      attributable: slice.covers.length === 1,
      briefBytes: briefBytes(subject),
    },
    live: live === null ? null : {
      ownerClockMin: 0,
      wallMin: Number((live.run.wallMs / 60000).toFixed(1)),
      costUsd: live.run.costUsd,
      inputTokens: live.run.inputTokens,
      outputTokens: live.run.outputTokens,
      toolCalls: live.run.toolCalls,
      toolCallsBeforeFirstWrite: live.toolCallsBeforeFirstWrite,
      filingAttempts: live.run.filingAttempts,
      filed: live.filed,
      bodyBytes: live.body?.bytes ?? null,
      briefBytes: live.filed === null ? null : briefBytes(live.filed),
    },
  };
}

console.log(JSON.stringify(report, null, 2));
