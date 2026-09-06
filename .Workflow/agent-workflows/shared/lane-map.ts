import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LANE_WIRING, type Gate, type LaneWiring } from "./lane-wiring";

export const LANE_MAP_RELATIVE_PATH = "docs/agents/lane-map.md";
const AGENT_WORKFLOWS = ".Workflow/agent-workflows";
const WORKFLOWS_DIR = ".github/workflows";
const DOCS_DIR = "docs/agents";

const OWNER = "owner";
const SESSION_END = "session-end";
const MAIN = "main";
const NEEDS_HUMAN_LABEL = "needs-human";
const NOBODY = "nobody";

export type NodeKind = "model" | "wire" | "source" | "sink" | "nobody";

export interface LaneNode {
  id: string;
  name: string;
  kind: NodeKind;
  number?: string;
  doc?: string;
  entrypoint?: string;
  shipsToCallers: boolean;
  wakesOn: string[];
  rings: string[];
  labelsApplied: string[];
  labelsCleared: string[];
  stops: string[];
  pushesMain: boolean;
}

export interface Edge {
  from: string;
  to: string;
  label: string;
  kind: "event" | "label" | "run" | "push" | "hand" | "stop";
}

export interface RunTally {
  worked: number;
  skipped: number;
  red: number;
  cancelled: number;
}

export interface LaneMap {
  nodes: LaneNode[];
  edges: Edge[];
  events: EventRow[];
  runs: Map<string, RunTally>;
  window?: { since: string; until: string; repository: string };
}

export interface EventRow {
  event: string;
  rungBy: string[];
  wakes: string[];
}

interface SourceFile {
  path: string;
  text: string;
  imports: Map<string, string>;
  functions: Map<string, string>;
}

interface Corpus {
  files: Map<string, SourceFile>;
  constants: Map<string, string>;
}

const SKIP_FILE = /\.(test|fixture|fake|proc\.test)\.ts$/;
const IMPORT_RE = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+"(\.[^"]+)"/g;
const EVENT_SEND_RE = /event_type[:=]\s*\$?\{?\s*("[\w-]+"|[A-Z][A-Z0-9_]+)(?![\w.])/g;
const ADD_LABEL_RE = /--add-label",\s*("[\w-]+"|[A-Z][A-Z0-9_]+)/g;
const REMOVE_LABEL_RE = /--remove-label",\s*("[\w-]+"|[A-Z][A-Z0-9_]+)/g;
const CREATE_LABEL_RE = /"create"[^\]]*?"--label",\s*("[\w-]+"|[A-Z][A-Z0-9_]+)/g;
const HELPER_LABEL_RE = /--add-label",\s*[a-z]\w*\]/;
const YAML_ADD_LABEL_RE = /--add-label\s+([\w-]+)/g;
const YAML_EVENT_SEND_RE = /event_type=([\w-]+)/g;
const CONST_RE = /(?:^|\n)(?:export )?const ([A-Z][A-Z0-9_]+) = (?:"([\w-]+)"|([A-Z][A-Z0-9_]+));/g;
const FUNCTION_RE = /(?:^|\n)(?:export )?(?:(?:async )?function (\w+)\(|const (\w+) = (?:async )?\()/g;
const CALL_RE = /(?<![\w.])(\w+)\(/g;
const ENTRYPOINT_RE = /agent-workflows\/([\w/-]+\.ts)/;
const LABEL_GATE_RE = /label\.name == '([^']+)'|labels\.\*\.name, '([^']+)'/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return entry.name.endsWith(".ts") && !SKIP_FILE.test(entry.name) ? [path] : [];
  });
}

function matches(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((match) => match.slice(1).find((group) => group !== undefined) ?? "");
}

function resolveConstant(raw: string, constants: Map<string, string>, depth = 0): string | undefined {
  if (raw.startsWith('"')) return raw.slice(1, -1);
  const value = constants.get(raw);
  if (value === undefined || depth > 5) return undefined;
  return /^[A-Z][A-Z0-9_]+$/.test(value) ? resolveConstant(value, constants, depth + 1) : value;
}

function functionBodies(text: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const heads = [...text.matchAll(FUNCTION_RE)];
  heads.forEach((head, index) => {
    const start = head.index ?? 0;
    const end = heads[index + 1]?.index ?? text.length;
    bodies.set(head[1] ?? head[2], text.slice(start, end));
  });
  return bodies;
}

function importsOf(path: string, text: string): Map<string, string> {
  const imports = new Map<string, string>();
  for (const match of text.matchAll(IMPORT_RE)) {
    const target = resolve(dirname(path), match[2]);
    const file = target.endsWith(".ts") ? target : `${target}.ts`;
    for (const specifier of match[1].split(",")) {
      const local = specifier.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (local) imports.set(local, file);
    }
  }
  return imports;
}

function readCorpus(root: string): Corpus {
  const files = new Map<string, SourceFile>();
  for (const path of walk(join(root, AGENT_WORKFLOWS))) {
    const text = readFileSync(path, "utf8");
    files.set(path, { path, text, imports: importsOf(path, text), functions: functionBodies(text) });
  }
  const constants = new Map<string, string>();
  for (const { text } of files.values()) {
    for (const match of text.matchAll(CONST_RE)) constants.set(match[1], match[2] ?? match[3]);
  }
  return { files, constants };
}

function reachableBodies(corpus: Corpus, entrypoint: string): string[] {
  const entry = corpus.files.get(entrypoint);
  if (!entry) return [];
  const seen = new Set<string>();
  const queue: { file: SourceFile; name: string }[] = [...entry.functions.keys()].map((name) => ({ file: entry, name }));
  const bodies: string[] = [entry.text];
  while (queue.length > 0) {
    const { file, name } = queue.shift() as { file: SourceFile; name: string };
    const key = `${file.path}#${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const body = file.functions.get(name);
    if (body === undefined) continue;
    bodies.push(body);
    for (const local of file.functions.keys()) if (local !== name && mentions(body, local)) queue.push({ file, name: local });
    for (const [imported, path] of file.imports) {
      const target = corpus.files.get(path);
      if (target?.functions.has(imported) && mentions(body, imported)) queue.push({ file: target, name: imported });
    }
  }
  return bodies;
}

function mentions(body: string, name: string): boolean {
  return new RegExp(`(?<![\\w.])${name}(?![\\w])`).test(body);
}

function labelsAppliedBy(code: string, corpus: Corpus): string[] {
  const raws = [...matches(ADD_LABEL_RE, code), ...matches(CREATE_LABEL_RE, code)];
  const helpers = new Set<string>();
  for (const file of corpus.files.values()) {
    for (const [name, body] of file.functions) if (HELPER_LABEL_RE.test(body)) helpers.add(name);
  }
  for (const helper of helpers) {
    for (const call of code.matchAll(new RegExp(`(?<![\\w.])${helper}\\(([^()]*)\\)`, "g"))) {
      const last = call[1].split(",").pop()?.trim() ?? "";
      if (/^("[\w-]+"|[A-Z][A-Z0-9_]+)$/.test(last)) raws.push(last);
    }
  }
  return raws.flatMap((raw) => resolveConstant(raw, corpus.constants) ?? []);
}

function gateLabels(gate: Gate | undefined): string[] {
  const clauses = [...(gate?.has ?? []), ...(gate?.is ? [gate.is] : [])];
  return [...new Set(clauses.flatMap((clause) => matches(LABEL_GATE_RE, clause)))];
}

function stepRuns(wiring: LaneWiring): string[] {
  return Object.values(wiring.jobs).flatMap((job) => (job.steps ?? []).flatMap((step) => step.run ?? []));
}

function yamlName(root: string, lane: string): string | undefined {
  const path = join(root, WORKFLOWS_DIR, `${lane}-caller.yml`);
  const fallback = join(root, WORKFLOWS_DIR, `${lane}.yml`);
  const file = existsSync(path) ? path : existsSync(fallback) ? fallback : undefined;
  if (!file) return undefined;
  return /^name:\s*(.+)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim();
}

function docFor(root: string, lane: string): { doc: string; number?: string } | undefined {
  const dir = join(root, DOCS_DIR);
  if (!existsSync(dir)) return undefined;
  const docs = readdirSync(dir).filter((name) => name.endsWith("-lane-edges.md"));
  const byName = docs.find((name) => name.startsWith(`${lane}-`)) ?? docs.find((name) => name.startsWith(lane.slice(0, 5)) || lane.includes(name.replace("-lane-edges.md", "")));
  const byMention = docs
    .map((name) => ({ name, hits: readFileSync(join(dir, name), "utf8").split(`${lane}.yml`).length - 1 }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)[0]?.name;
  const doc = byName ?? byMention;
  if (!doc) return undefined;
  const number = /Lane (\d\d), followed end to end/.exec(readFileSync(join(dir, doc), "utf8"))?.[1];
  return { doc, number };
}

function doorsOf(lane: string, wiring: LaneWiring): { wakesOn: string[]; edges: Edge[] } {
  const on = (wiring.caller?.on ?? wiring.on ?? {}) as Record<string, unknown>;
  const gate = { ...wiring.caller?.gate, ...Object.values(wiring.jobs)[0]?.gate };
  const labels = gateLabels(gate).concat(gateLabels(wiring.caller?.gate));
  const wakesOn: string[] = [];
  const edges: Edge[] = [];
  for (const [event, condition] of Object.entries(on)) {
    if (event === "repository_dispatch") {
      for (const type of condition as string[]) {
        wakesOn.push(`dispatch ${type}`);
        edges.push({ from: type === "session-captured" ? SESSION_END : `event:${type}`, to: lane, label: type, kind: "event" });
      }
    } else if (event === "workflow_run") {
      const { workflows } = condition as { workflows: string[] };
      for (const upstream of workflows) {
        wakesOn.push(`${upstream} completed`);
        edges.push({ from: `run:${upstream}`, to: lane, label: `${upstream} ended`, kind: "run" });
      }
    } else if (event === "push") {
      const paths = (condition as { paths?: string[]; "paths-ignore"?: string[] }).paths;
      wakesOn.push(`push to main${paths ? ` touching ${paths.join(", ")}` : ""}`);
      edges.push({ from: MAIN, to: lane, label: paths ? `push: ${paths[0]}${paths.length > 1 ? "…" : ""}` : "push", kind: "push" });
    } else if (event === "workflow_dispatch") {
      wakesOn.push("by hand");
      edges.push({ from: OWNER, to: lane, label: "by hand", kind: "hand" });
    } else if (event === "issues") {
      const types = condition as string[];
      const named = [...new Set(labels)];
      if (types.includes("labeled") && named.length > 0) {
        for (const label of named) {
          wakesOn.push(`label ${label}`);
          edges.push({ from: `label:${label}`, to: lane, label, kind: "label" });
        }
      } else {
        wakesOn.push(`issue ${types.join("/")}${named.length ? ` (${named.join(", ")})` : ""}`);
        edges.push({ from: OWNER, to: lane, label: `issue ${types.join("/")}`, kind: "hand" });
      }
    } else {
      wakesOn.push(`${event} ${(condition as string[]).join("/")}`);
      edges.push({ from: OWNER, to: lane, label: `${event.replace("_", " ")} ${(condition as string[]).join("/")}`, kind: "hand" });
    }
  }
  return { wakesOn, edges };
}

export function buildLaneMap(root: string, runs: Map<string, RunTally> = new Map(), window?: LaneMap["window"]): LaneMap {
  const corpus = readCorpus(root);
  const nodes: LaneNode[] = [];
  const rawEdges: Edge[] = [];

  for (const [lane, wiring] of Object.entries(LANE_WIRING)) {
    const entry = Object.values(wiring.jobs).map((job) => ENTRYPOINT_RE.exec(job.runs ?? "")?.[1]).find(Boolean);
    const code = entry ? reachableBodies(corpus, join(root, AGENT_WORKFLOWS, entry)).join("\n") : "";
    const yaml = stepRuns(wiring).join("\n");
    const resolved = (raws: string[]) => raws.flatMap((raw) => resolveConstant(raw, corpus.constants) ?? []);

    const rings = new Set<string>([...matches(YAML_EVENT_SEND_RE, yaml), ...resolved(matches(EVENT_SEND_RE, code))]);
    const labelsApplied = new Set<string>([...matches(YAML_ADD_LABEL_RE, yaml), ...labelsAppliedBy(code, corpus)]);
    const labelsCleared = new Set(resolved(matches(REMOVE_LABEL_RE, code)));

    const stops: string[] = [];
    if (labelsApplied.has(NEEDS_HUMAN_LABEL)) stops.push("labels needs-human");
    for (const refusal of [...labelsApplied].filter((label) => /refused|failed/.test(label))) stops.push(`labels ${refusal}`);

    const hasModel = Object.values(wiring.jobs).some((job) => job.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined);
    const located = docFor(root, lane);
    const { wakesOn, edges } = doorsOf(lane, wiring);
    rawEdges.push(...edges);

    nodes.push({
      id: lane,
      name: wiring.caller?.name ?? yamlName(root, lane) ?? lane,
      kind: hasModel ? "model" : "wire",
      number: located?.number,
      doc: located?.doc,
      entrypoint: entry,
      shipsToCallers: wiring.caller !== undefined,
      wakesOn,
      rings: [...rings].sort(),
      labelsApplied: [...labelsApplied].sort(),
      labelsCleared: [...labelsCleared].sort(),
      stops,
      pushesMain: /HEAD:main|"pr",\s*"merge"/.test(code),
    });
  }

  const byName = new Map(nodes.map((node) => [node.name, node.id]));
  const producers = (event: string) => [
    ...(event === "session-captured" ? [SESSION_END] : []),
    ...nodes.filter((node) => node.rings.includes(event)).map((node) => node.id),
  ];
  const appliers = (label: string) => nodes.filter((node) => node.labelsApplied.includes(label)).map((node) => node.id);

  const edges: Edge[] = [];
  const events = new Map<string, EventRow>();
  const pills = new Map<string, string[]>();
  const byHand = (target: string, door: string) => {
    const id = `you:${target}`;
    pills.set(id, [...(pills.get(id) ?? []), door]);
    edges.push({ from: id, to: target, label: "", kind: "hand" });
  };
  for (const edge of rawEdges) {
    if (edge.from.startsWith("event:") || edge.from === SESSION_END) {
      const event = edge.from === SESSION_END ? edge.label : edge.from.slice(6);
      const from = producers(event);
      const row = events.get(event) ?? { event, rungBy: from, wakes: [] };
      row.wakes.push(edge.to);
      events.set(event, row);
      if (from.length === 0) edges.push({ ...edge, from: NOBODY });
      for (const producer of from) edges.push({ ...edge, from: producer });
    } else if (edge.from.startsWith("label:")) {
      const label = edge.from.slice(6);
      byHand(edge.to, `label ${label}`);
      for (const applier of appliers(label)) edges.push({ ...edge, from: applier, label: `labels ${label}` });
    } else if (edge.from.startsWith("run:")) {
      const upstream = byName.get(edge.from.slice(4));
      edges.push({ ...edge, from: upstream ?? NOBODY });
    } else if (edge.from === OWNER) {
      byHand(edge.to, edge.label);
    } else {
      edges.push(edge);
    }
  }
  for (const node of nodes) {
    for (const event of node.rings) {
      if (!events.has(event)) events.set(event, { event, rungBy: producers(event), wakes: [] });
    }
    if (node.pushesMain) edges.push({ from: node.id, to: MAIN, label: "lands on main", kind: "push" });
  }
  byHand(MAIN, "push");

  const blank = { shipsToCallers: false, wakesOn: [], rings: [], labelsApplied: [], labelsCleared: [], stops: [], pushesMain: false };
  const fixed: LaneNode[] = [
    { id: SESSION_END, name: "session end hook", kind: "source", ...blank, rings: ["session-captured"] },
    { id: MAIN, name: "main", kind: "source", ...blank },
    ...[...pills].map(([id, doors]) => ({ id, name: pillName([...new Set(doors)]), kind: "source" as const, ...blank })),
  ];
  if (edges.some((edge) => edge.from === NOBODY)) {
    fixed.push({ id: NOBODY, name: "nothing rings this", kind: "nobody", shipsToCallers: false, wakesOn: [], rings: [], labelsApplied: [], labelsCleared: [], stops: [], pushesMain: false });
  }

  return {
    nodes: [...fixed, ...nodes],
    edges: dedupe(edges),
    events: [...events.values()].sort((a, b) => a.event.localeCompare(b.event)),
    runs,
    window,
  };
}

function pillName(doors: string[]): string {
  const labels = doors.filter((door) => door.startsWith("label ")).map((door) => door.slice(6));
  const rest = doors.filter((door) => !door.startsWith("label ")).map((door) => door.replace(/issue[ _]comment created/, "comment"));
  return `you: ${[...(labels.length > 0 ? [`label ${labels.join("/")}`] : []), ...rest].join(" · ")}`;
}

function dedupe(edges: Edge[]): Edge[] {
  const merged = new Map<string, Edge>();
  for (const edge of edges) {
    const key = `${edge.from}>${edge.to}`;
    const existing = merged.get(key);
    if (!existing) merged.set(key, { ...edge });
    else if (!existing.label.split(" · ").includes(edge.label)) existing.label = `${existing.label} · ${edge.label}`;
  }
  return [...merged.values()];
}

export function tallyRuns(rows: { name: string; conclusion: string | null }[], nodes: LaneNode[]): Map<string, RunTally> {
  const canonical = new Map<string, string>();
  for (const node of nodes) {
    for (const suffix of ["", " (caller)", " (reusable)"]) canonical.set(`${node.name}${suffix}`, node.id);
  }
  const tallies = new Map<string, RunTally>();
  for (const row of rows) {
    const id = canonical.get(row.name);
    if (!id) continue;
    const tally = tallies.get(id) ?? { worked: 0, skipped: 0, red: 0, cancelled: 0 };
    if (row.conclusion === "skipped") tally.skipped += 1;
    else if (row.conclusion === "failure") tally.red += 1;
    else if (row.conclusion === "cancelled") tally.cancelled += 1;
    else tally.worked += 1;
    tallies.set(id, tally);
  }
  return tallies;
}

interface Placed {
  node: LaneNode;
  layer: number;
  x: number;
  y: number;
}

const BOX_W = 168;
const BOX_H = 52;
const ROW_GAP = 104;
const COL_GAP = 26;
const STAGGER_ABOVE = 6;

function layout(map: LaneMap): { placed: Map<string, Placed>; width: number; height: number; back: Set<Edge> } {
  const ids = map.nodes.map((node) => node.id);
  const forward = map.edges.filter((edge) => edge.from !== edge.to);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of forward) out.get(edge.from)?.push(edge.to);

  const state = new Map<string, "open" | "done">();
  const back = new Set<Edge>();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const edge of forward.filter((candidate) => candidate.from === id)) {
      const mark = state.get(edge.to);
      if (mark === "open") back.add(edge);
      else if (mark === undefined) visit(edge.to);
    }
    state.set(id, "done");
  };
  for (const id of ids) if (!state.has(id)) visit(id);

  const layered = forward.filter((edge) => !back.has(edge));
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass += 1) {
    let moved = false;
    for (const edge of layered) {
      const want = (layer.get(edge.from) ?? 0) + 1;
      if ((layer.get(edge.to) ?? 0) < want) {
        layer.set(edge.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const edge of layered) {
    if (edge.from.startsWith("you:")) layer.set(edge.from, Math.max(0, (layer.get(edge.to) ?? 1) - 1));
  }

  const rows = new Map<number, string[]>();
  for (const id of ids) {
    const depth = layer.get(id) ?? 0;
    rows.set(depth, [...(rows.get(depth) ?? []), id]);
  }
  const position = new Map<string, number>();
  const order = [...rows.keys()].sort((a, b) => a - b);
  for (const depth of order) rows.get(depth)?.forEach((id, index) => position.set(id, index));
  for (let sweep = 0; sweep < 6; sweep += 1) {
    const downward = sweep % 2 === 0;
    for (const depth of downward ? order : [...order].reverse()) {
      const row = rows.get(depth) ?? [];
      const bary = (id: string) => {
        const neighbours = layered
          .filter((edge) => (downward ? edge.to === id : edge.from === id))
          .map((edge) => position.get(downward ? edge.from : edge.to) ?? 0);
        return neighbours.length === 0 ? position.get(id) ?? 0 : neighbours.reduce((a, b) => a + b, 0) / neighbours.length;
      };
      const sorted = [...row].sort((a, b) => bary(a) - bary(b));
      rows.set(depth, sorted);
      sorted.forEach((id, index) => position.set(id, index));
    }
  }

  const step = BOX_W + COL_GAP;
  const spanOf = (row: string[]) => (row.length > STAGGER_ABOVE ? (row.length + 1) / 2 : row.length) * step - COL_GAP;
  const width = Math.max(...[...rows.values()].map(spanOf)) + 2 * COL_GAP;
  const placed = new Map<string, Placed>();
  let y = 20;
  for (const depth of order) {
    const row = rows.get(depth) ?? [];
    const staggered = row.length > STAGGER_ABOVE;
    const left = (width - spanOf(row)) / 2;
    row.forEach((id, index) => {
      const node = map.nodes.find((candidate) => candidate.id === id) as LaneNode;
      const x = staggered ? left + (index * step) / 2 : left + index * step;
      placed.set(id, { node, layer: depth, x, y: y + (staggered && index % 2 === 1 ? BOX_H + 14 : 0) });
    });
    y += ROW_GAP + (staggered ? BOX_H + 14 : 0);
  }
  return { placed, width, height: y, back };
}

function splitPill(title: string): [string, string?] {
  if (title.length <= 26) return [title];
  const middle = title.length / 2;
  const breaks = [...title.matchAll(/[ /]/g)].map((match) => match.index ?? 0);
  const at = breaks.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
  if (at === undefined) return [title];
  return [title.slice(0, at + (title[at] === "/" ? 1 : 0)).trim(), title.slice(at + 1).trim()];
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isIdle(map: LaneMap, node: LaneNode): boolean {
  if (node.kind !== "model" && node.kind !== "wire") return false;
  if (!map.window) return false;
  const tally = map.runs.get(node.id);
  return !tally || tally.worked + tally.red + tally.cancelled === 0;
}

export function renderSvg(map: LaneMap): string {
  const { placed, width, height, back } = layout(map);
  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;font-family:system-ui,sans-serif;display:block;margin:1rem auto">`);
  lines.push("<style>");
  lines.push(".lm-box{stroke-width:1.5}.lm-model{fill:#fde68a;stroke:#b45309}.lm-wire{fill:#bfdbfe;stroke:#1d4ed8}.lm-source{fill:#e5e7eb;stroke:#4b5563}.lm-sink{fill:#fecaca;stroke:#b91c1c}.lm-nobody{fill:none;stroke:#b91c1c;stroke-dasharray:4 3}");
  lines.push(".lm-idle{opacity:.45;stroke-dasharray:5 3}.lm-text{fill:#111;font-size:12.5px;font-weight:600}.lm-pill{fill:#111;font-size:11px;font-weight:600}.lm-sub{fill:#444;font-size:10px}.lm-stopline{fill:#b91c1c;font-size:10px}.lm-edge{fill:none;stroke:#6b7280;stroke-width:1.2}.lm-stop{stroke:#b91c1c}.lm-back{stroke-dasharray:6 4}.lm-label{font-size:10.5px;fill:#374151;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}");
  lines.push("@media (prefers-color-scheme:dark){.lm-model{fill:#78350f;stroke:#fbbf24}.lm-wire{fill:#1e3a8a;stroke:#93c5fd}.lm-source{fill:#374151;stroke:#d1d5db}.lm-sink{fill:#7f1d1d;stroke:#fca5a5}.lm-text{fill:#f3f4f6}.lm-pill{fill:#f3f4f6}.lm-sub{fill:#d1d5db}.lm-stopline{fill:#fca5a5}.lm-edge{stroke:#9ca3af}.lm-label{fill:#e5e7eb;stroke:#111827}}");
  lines.push("</style>");
  lines.push('<defs><marker id="lm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#6b7280"/></marker></defs>');

  const arrivals = new Map<string, number>();
  for (const edge of map.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to || edge.from === edge.to) continue;
    const reversed = back.has(edge) || to.layer <= from.layer;
    const arrival = arrivals.get(edge.to) ?? 0;
    arrivals.set(edge.to, arrival + 1);
    let path: string;
    let lx: number;
    let ly: number;
    if (!reversed) {
      const x1 = from.x + BOX_W / 2;
      const y1 = from.y + BOX_H;
      const x2 = to.x + BOX_W / 2;
      const y2 = to.y;
      const bend = (y2 - y1) / 2;
      path = `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`;
      const t = 0.8 - (arrival % 3) * 0.13;
      const u = 1 - t;
      lx = u * u * u * x1 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x2;
      ly = u * u * u * y1 + 3 * u * u * t * (y1 + bend) + 3 * u * t * t * (y2 - bend) + t * t * t * y2 - 4;
    } else {
      const x1 = from.x + BOX_W;
      const y1 = from.y + BOX_H / 2;
      const x2 = to.x + BOX_W;
      const y2 = to.y + BOX_H / 2;
      const swing = 60 + Math.abs(from.layer - to.layer) * 10;
      path = `M${x1},${y1} C${x1 + swing},${y1} ${x2 + swing},${y2} ${x2},${y2}`;
      lx = Math.max(x1, x2) + swing * 0.75;
      ly = (y1 + y2) / 2;
    }
    const classes = ["lm-edge", edge.kind === "stop" ? "lm-stop" : "", reversed ? "lm-back" : ""].filter(Boolean).join(" ");
    lines.push(`<path class="${classes}" d="${path}" marker-end="url(#lm-arrow)"/>`);
    if (edge.label) lines.push(`<text class="lm-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${escape(edge.label)}</text>`);
  }

  for (const { node, x, y } of placed.values()) {
    const idle = isIdle(map, node);
    const classes = ["lm-box", `lm-${node.kind}`, idle ? "lm-idle" : ""].filter(Boolean).join(" ");
    const isLane = node.kind === "model" || node.kind === "wire";
    const height = isLane ? BOX_H : 34;
    const top = isLane ? y : y + (BOX_H - height) / 2;
    lines.push(`<rect class="${classes}" x="${x}" y="${top}" width="${BOX_W}" height="${height}" rx="${isLane ? 6 : 17}"/>`);
    const title = node.number ? `${node.number} · ${node.name}` : node.name;
    const tally = map.runs.get(node.id);
    const sub = isLane ? (tally ? `${tally.worked + tally.red + tally.cancelled} ran · ${tally.skipped} skipped · ${tally.red} red` : map.window ? "0 runs" : node.kind) : "";
    const stop = node.stops.map((entry) => entry.replace("labels ", "")).join(", ");
    const [first, second] = isLane ? [title] : splitPill(title);
    if (second) {
      lines.push(`<text class="lm-pill" x="${x + BOX_W / 2}" y="${top + 14}" text-anchor="middle">${escape(first)}</text>`);
      lines.push(`<text class="lm-pill" x="${x + BOX_W / 2}" y="${top + 26}" text-anchor="middle">${escape(second)}</text>`);
      continue;
    }
    lines.push(`<text class="${isLane ? "lm-text" : "lm-pill"}" x="${x + BOX_W / 2}" y="${top + (isLane ? 16 : 21)}" text-anchor="middle">${escape(title)}</text>`);
    if (sub) lines.push(`<text class="lm-sub" x="${x + BOX_W / 2}" y="${top + 30}" text-anchor="middle">${escape(sub)}</text>`);
    if (stop) lines.push(`<text class="lm-stopline" x="${x + BOX_W / 2}" y="${top + 44}" text-anchor="middle">stops: ${escape(stop)}</text>`);
  }
  lines.push("</svg>");
  return lines.join("\n");
}

function cell(items: string[]): string {
  return items.length === 0 ? "" : items.map((item) => `\`${item}\``).join(", ");
}

function link(node: LaneNode): string {
  return node.doc ? `[${node.name}](${node.doc})` : node.name;
}

export function findings(map: LaneMap): string[] {
  const lanes = map.nodes.filter((node) => node.kind === "model" || node.kind === "wire");
  const out: string[] = [];

  const unrung = map.events.filter((row) => row.rungBy.length === 0 && row.wakes.length > 0);
  for (const row of unrung) out.push(`**\`${row.event}\` is a door nothing in the tree rings.** It wakes ${row.wakes.join(", ")}; the only way in is by hand.`);

  const unheard = map.events.filter((row) => row.wakes.length === 0 && row.rungBy.length > 0);
  for (const row of unheard) out.push(`**\`${row.event}\` is rung by ${row.rungBy.join(", ")} and nothing wakes on it.**`);

  const stalled = map.edges.filter((edge) => edge.from === NOBODY && edge.kind === "run");
  for (const edge of stalled) out.push(`**${edge.to} listens for a workflow named "${edge.label.replace(" ended", "")}" that no lane here produces.**`);

  if (map.window) {
    const idle = lanes.filter((node) => isIdle(map, node));
    if (idle.length > 0) {
      const named = idle.map((node) => {
        const tally = map.runs.get(node.id);
        return tally ? `${node.name} (fired ${tally.skipped}×, skipped every time)` : `${node.name} (never fired)`;
      });
      out.push(`**${idle.length} lanes did no work in the window:** ${named.join("; ")}.`);
    }
  }

  const writers = lanes.filter((node) => node.labelsApplied.includes(NEEDS_HUMAN_LABEL)).map((node) => node.name);
  const readers = lanes.filter((node) => node.labelsCleared.includes(NEEDS_HUMAN_LABEL)).map((node) => node.name);
  if (writers.length > 0) {
    out.push(`**\`needs-human\` is written by ${writers.length} lanes (${writers.join(", ")}) and cleared by ${readers.length === 0 ? "none" : readers.join(", ")}.** Nothing else reads it; a ticket that carries it waits for you.`);
  }

  const refusals = lanes.flatMap((node) => node.stops.filter((stop) => !stop.includes(NEEDS_HUMAN_LABEL)).map((stop) => `${node.name} ${stop}`));
  if (refusals.length > 0) {
    const read = refusals.filter((refusal) => lanes.some((node) => node.wakesOn.some((door) => door.includes(refusal.split(" ").pop() ?? ""))));
    const unread = refusals.filter((refusal) => !read.includes(refusal));
    if (unread.length > 0) out.push(`**Refusal labels no lane wakes on:** ${unread.join("; ")}. Each is a stop with no reader.`);
  }

  const islands = lanes.filter((node) => !map.edges.some((edge) => (edge.from === node.id && lanes.some((other) => other.id === edge.to)) || (edge.to === node.id && lanes.some((other) => other.id === edge.from))));
  if (islands.length > 0) out.push(`**Lanes no other lane rings or hears:** ${islands.map((node) => node.name).join(", ")}. They hang off you, the session hook, or a push alone.`);

  const machineOnly = lanes.filter((node) => !node.shipsToCallers).map((node) => node.name);
  if (machineOnly.length > 0) out.push(`**Machine-only, never shipped to an enrolled repository:** ${machineOnly.join(", ")}.`);

  return out;
}

export function renderLaneMap(map: LaneMap): string {
  const lanes = map.nodes.filter((node) => node.kind === "model" || node.kind === "wire");
  const modelCount = lanes.filter((node) => node.kind === "model").length;
  const lines: string[] = [];
  lines.push("# The lane map");
  lines.push("");
  lines.push(`Every lane on one page: ${lanes.length} lanes, ${modelCount} of them spending a model, drawn from`);
  lines.push("[`shared/lane-wiring.ts`](../../.Workflow/agent-workflows/shared/lane-wiring.ts) and the code each lane");
  lines.push("runs. Generated by `npm run lane-map`; regenerate it, never edit it. Each box links to the lane's");
  lines.push("walkthrough in the table below. A **box** is a lane; an **arrow** is the event that wakes the next one, and an");
  lines.push("arrow that leaves a lane for nowhere is a stop.");
  lines.push("");
  if (map.window) {
    lines.push(`Run counts are ${map.window.repository}'s Actions API, ${map.window.since} to ${map.window.until}. "Skipped" is a run`);
    lines.push("that fired, evaluated its gate, and did nothing. A faded, dashed box did no work in the window.");
    lines.push("");
  }
  lines.push("Amber is a lane that spends a model; blue is deterministic TypeScript; grey pills are the outside world,");
  lines.push("you included. A red line inside a box is a stop: a label the lane writes that no lane reads, so the ticket");
  lines.push("waits for you. A dashed arrow is a ring back up the page.");
  lines.push("");
  lines.push(renderSvg(map));
  lines.push("");
  lines.push("## What is not connected");
  lines.push("");
  for (const finding of findings(map)) lines.push(`- ${finding}`);
  lines.push("");
  lines.push("## Lanes");
  lines.push("");
  lines.push(`| Lane | Kind | Wakes on | Rings | Labels it writes | Runs${map.window ? " (green / red / cancelled / skipped)" : ""} | Code |`);
  lines.push("|---|---|---|---|---|---|---|");
  const sorted = [...lanes].sort((a, b) => (a.number ?? "99").localeCompare(b.number ?? "99") || a.name.localeCompare(b.name));
  for (const node of sorted) {
    const tally = map.runs.get(node.id);
    const runs = map.window ? (tally ? `${tally.worked} / ${tally.red} / ${tally.cancelled} / ${tally.skipped}` : "0 / 0 / 0 / 0") : "";
    const name = `${node.number ? `${node.number} ` : ""}${link(node)}${node.shipsToCallers ? "" : " (machine only)"}`;
    const labels = node.labelsApplied.map((label) => (node.stops.includes(`labels ${label}`) ? `**\`${label}\`** (stop)` : `\`${label}\``)).join(", ");
    lines.push(`| ${name} | ${node.kind} | ${cell(node.wakesOn)} | ${cell([...node.rings, ...(node.pushesMain ? ["push to main"] : [])])} | ${labels} | ${runs} | ${node.entrypoint ? `\`${node.entrypoint}\`` : ""} |`);
  }
  lines.push("");
  lines.push("## Events");
  lines.push("");
  lines.push("| Event | Rung by | Wakes |");
  lines.push("|---|---|---|");
  for (const row of map.events) {
    const rung = row.rungBy.length === 0 ? "**nobody**" : row.rungBy.join(", ");
    const wakes = row.wakes.length === 0 ? "**nobody**" : row.wakes.join(", ");
    lines.push(`| \`${row.event}\` | ${rung} | ${wakes} |`);
  }
  lines.push("");
  return lines.join("\n");
}
