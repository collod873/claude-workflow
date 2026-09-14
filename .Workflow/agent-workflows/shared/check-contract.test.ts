import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, test } from "vitest";
import { parseCheckSlots, readCheckContract, renderCheckContractSection } from "./check-contract";
import { REPO_ROOT } from "./repo-sources";

const CONTRACT = JSON.stringify({
  stop: { cmd: "bin/gauntlet stop", why: ".claude/hooks/gauntlet.sh#check-command" },
  all: { cmd: "npm run check", why: "package.json#scripts.check" },
});

describe("parseCheckSlots", () => {
  it("reads this repo's own check contract", () => {
    expect(parseCheckSlots(readCheckContract()).map((slot) => slot.name)).toContain("all");
  });

  it("keeps the contract's own slot order, so the brief reads as the file does", () => {
    expect(parseCheckSlots(CONTRACT).map((slot) => slot.name)).toEqual(["stop", "all"]);
  });

  it("drops a slot nulled to shrink the gate rather than reporting a command the runner will not run", () => {
    expect(parseCheckSlots(JSON.stringify({ clones: null, all: { cmd: "npm run check" } }))).toEqual([
      { name: "all", cmd: "npm run check", why: "" },
    ]);
  });

  it("reads an absent contract as no slots, never as a gate that runs nothing", () => {
    expect(parseCheckSlots(undefined)).toEqual([]);
  });

  it("reads an unparseable contract as no slots rather than throwing inside the brief", () => {
    expect(parseCheckSlots("{ not json")).toEqual([]);
  });
});

describe("renderCheckContractSection", () => {
  it("names each slot, its command, and where the command is declared", () => {
    expect(renderCheckContractSection(CONTRACT)).toBe(
      [
        "- `stop`: `bin/gauntlet stop` — .claude/hooks/gauntlet.sh#check-command",
        "- `all`: `npm run check` — package.json#scripts.check",
      ].join("\n"),
    );
  });

  it("names a slot carrying no declaration site by command alone", () => {
    expect(renderCheckContractSection(JSON.stringify({ all: { cmd: "npm run check" } }))).toBe("- `all`: `npm run check`");
  });

  it("renders the brief's placeholder when the target carries no contract", () => {
    expect(renderCheckContractSection(undefined)).toBe("(none)");
  });
});

const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "SessionStart",
  "SessionEnd",
];

const REFERENCE = /((?:[\w.@-]+\/)+[\w.@-]+\.\w+|package\.json)(?:#([\w.-]+))?/g;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function jsonAtoms(node: unknown, into: Set<string> = new Set<string>()): Set<string> {
  if (typeof node === "string") {
    into.add(node);
    return into;
  }
  if (Array.isArray(node)) {
    for (const item of node) jsonAtoms(item, into);
    return into;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      into.add(key);
      jsonAtoms(value, into);
    }
  }
  return into;
}

function anchorResolves(doc: unknown, anchor: string): boolean {
  const segments = anchor.split(".");
  let node: unknown = doc;
  for (const segment of segments) {
    if (node === null || typeof node !== "object" || Array.isArray(node) || !(segment in (node as Record<string, unknown>))) {
      return jsonAtoms(doc).has(segments[segments.length - 1] ?? anchor);
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return true;
}

function findRoster(dir: string, depth: number): string | undefined {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === "roster.json") return join(dir, entry.name);
  }
  if (depth <= 0) return undefined;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const found = findRoster(join(dir, entry.name), depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function rosterEvents(): Set<string> | undefined {
  const roster = findRoster(join(REPO_ROOT, ".claude"), 4);
  if (roster === undefined) return undefined;
  const doc = readJson(roster);
  return doc === undefined ? undefined : jsonAtoms(doc);
}

function whyProblems(slot: { name: string; why: string }, carried: Set<string> | undefined): string[] {
  const problems: string[] = [];
  for (const match of slot.why.matchAll(REFERENCE)) {
    const path = match[1] ?? "";
    const anchor = match[2];
    const full = join(REPO_ROOT, path);
    if (!existsSync(full)) {
      problems.push(`${slot.name}.why names ${path}, which does not exist`);
      continue;
    }
    if (anchor !== undefined && path.endsWith(".json") && !anchorResolves(readJson(full), anchor)) {
      problems.push(`${slot.name}.why names ${path}#${anchor}, which does not resolve`);
    }
  }
  if (carried !== undefined) {
    for (const event of HOOK_EVENTS) {
      if (new RegExp(`\\b${event}\\b`).test(slot.why) && !carried.has(event)) {
        problems.push(`${slot.name}.why names the ${event} event, which roster.json does not carry`);
      }
    }
  }
  return problems;
}

function cmdProblems(slot: { name: string; cmd: string }): string[] {
  const script = /^npm run ([\w:-]+)$/.exec(slot.cmd);
  if (script !== null) {
    const pkg = readJson(join(REPO_ROOT, "package.json")) as { scripts?: Record<string, string> } | undefined;
    const name = script[1] ?? "";
    return name in (pkg?.scripts ?? {}) ? [] : [`${slot.name}.cmd runs npm script ${name}, which package.json does not declare`];
  }
  const runner = slot.cmd.split(" ")[0] ?? "";
  if (!runner.includes("/")) return [];
  return existsSync(join(REPO_ROOT, runner)) ? [] : [`${slot.name}.cmd runs ${runner}, which does not exist`];
}

test("#555.1: the stop slot's why names stop-gate.py as the reader and the dispatch route as the wiring", () => {
  const stop = parseCheckSlots(readCheckContract()).find((slot) => slot.name === "stop");
  const why = stop?.why ?? "";

  expect(why).toContain("stop-gate.py");
  expect(why).not.toContain("settings.json#hooks.Stop");
  expect(why).toMatch(/dispatch|roster/i);
});

test("#555.2: every check slot's why names a file that exists and an event roster.json carries", () => {
  const slots = parseCheckSlots(readCheckContract());
  const carried = rosterEvents();

  expect(slots.map((slot) => slot.name)).toContain("stop");
  expect(slots.flatMap((slot) => whyProblems(slot, carried))).toEqual([]);
});

test("#555.5: the whole check contract resolves, every slot's command and why pointing at something real", () => {
  const slots = parseCheckSlots(readCheckContract());
  const carried = rosterEvents();

  expect(slots.length).toBeGreaterThan(0);
  expect(slots.flatMap((slot) => [...cmdProblems(slot), ...whyProblems(slot, carried)])).toEqual([]);
});
