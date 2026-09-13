export type YamlScalar = string | number | boolean;
export type YamlValue = YamlScalar | null | readonly YamlValue[] | YamlMap;
export interface YamlMap {
  readonly [key: string]: YamlValue | undefined;
}

const INDENT = "  ";
const FLOW_KEYS = new Set(["types", "branches", "needs"]);
const QUOTED_ITEM_KEYS = new Set(["paths", "paths-ignore"]);
const QUOTED_VALUE_KEYS = new Set(["description"]);
const QUOTED_KEYS = new Set(["on"]);
const SPACED_ARRAY_KEYS = new Set(["steps"]);
const SPACED_MAP_KEYS = new Set(["jobs"]);
const UNSPACED_TOP_KEYS = new Set(["run-name"]);
const RESERVED = /^(true|false|null|~|yes|no|on|off|y|n)$/i;
const NUMERIC = /^[-+]?(\d[\d_]*)?(\.\d*)?([eE][-+]?\d+)?$/;
const LEADING_INDICATOR = /^[,[\]{}#&*!|>'"%@`]/;
const DASH_INDICATOR = /^[-?:](\s|$)/;

function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function needsQuote(text: string): boolean {
  if (text === "") return true;
  if (text !== text.trim()) return true;
  if (LEADING_INDICATOR.test(text) || DASH_INDICATOR.test(text)) return true;
  if (/:(\s|$)/.test(text) || /\s#/.test(text)) return true;
  if (RESERVED.test(text)) return true;
  return NUMERIC.test(text) && /\d/.test(text);
}

function scalar(value: YamlScalar, forceQuote: boolean): string {
  if (typeof value !== "string") return String(value);
  return forceQuote || needsQuote(value) ? quote(value) : value;
}

function isList(value: YamlValue): value is readonly YamlValue[] {
  return Array.isArray(value);
}

function isMap(value: YamlValue): value is YamlMap {
  return typeof value === "object" && !isList(value);
}

function entries(map: YamlMap): [string, YamlValue][] {
  return Object.entries(map).flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as [string, YamlValue]]));
}

function blockScalar(text: string, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const body = text.replace(/\n+$/, "").split("\n");
  return ["|", ...body.map((line) => (line === "" ? "" : `${pad}${line}`))];
}

function flowList(items: readonly YamlValue[], quoted: boolean): string {
  return `[${items.map((item) => scalar(item as YamlScalar, quoted)).join(", ")}]`;
}

function renderKey(key: string): string {
  return QUOTED_KEYS.has(key) ? quote(key) : key;
}

function renderEntry(key: string, value: YamlValue, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const head = `${pad}${renderKey(key)}:`;
  if (value === null) return [head];

  if (isList(value)) {
    if (value.length === 0) return [`${head} []`];
    const quoted = QUOTED_ITEM_KEYS.has(key);
    if (FLOW_KEYS.has(key)) return [`${head} ${flowList(value, quoted)}`];
    const spaced = SPACED_ARRAY_KEYS.has(key);
    return [head, ...value.flatMap((item, index) => (spaced && index > 0 ? ["", ...renderItem(item, depth + 1, quoted)] : renderItem(item, depth + 1, quoted)))];
  }

  if (isMap(value)) {
    const rows = entries(value);
    if (rows.length === 0) return [head];
    const spaced = SPACED_MAP_KEYS.has(key);
    return [head, ...rows.flatMap(([name, nested], index) => (spaced && index > 0 ? ["", ...renderEntry(name, nested, depth + 1)] : renderEntry(name, nested, depth + 1)))];
  }

  if (typeof value === "string" && value.includes("\n")) {
    const [marker, ...body] = blockScalar(value, depth + 1);
    return [`${head} ${marker}`, ...body];
  }

  return [`${head} ${scalar(value, QUOTED_VALUE_KEYS.has(key))}`];
}

function renderItem(item: YamlValue, depth: number, quoted: boolean): string[] {
  const pad = INDENT.repeat(depth);
  if (Array.isArray(item) || isMap(item)) {
    const rows = isMap(item) ? entries(item) : [];
    const lines = rows.flatMap(([key, value]) => renderEntry(key, value, depth + 1));
    return [`${pad}- ${lines[0].slice(pad.length + INDENT.length)}`, ...lines.slice(1)];
  }
  return [`${pad}- ${scalar(item as YamlScalar, quoted)}`];
}

export function printYaml(document: YamlMap): string {
  const lines = entries(document).flatMap(([key, value], index) =>
    index > 0 && !UNSPACED_TOP_KEYS.has(key) ? ["", ...renderEntry(key, value, 0)] : renderEntry(key, value, 0),
  );
  return `${lines.join("\n")}\n`;
}
