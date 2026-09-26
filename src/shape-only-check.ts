import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { checks, matchEnd, quoted } from "./ticket-shape.ts";

const VITEST_RUN = /^npx vitest run\b/;
const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const DEFAULT_IMPORT = /import\s+([A-Za-z_$][\w$]*)\s*from\s*["']([^"']+)["']/g;
const TOP_LEVEL_FUNCTION = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
const TOP_LEVEL_CONST = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/gm;
const CALL_SITE = /\b(describe|it|test)(?:\.\w+)*\s*\(/g;
const SPAWN_SITE = /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(/g;
const CALLED_NAME = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const SCENARIOS_SOURCE = readFileSync(join(import.meta.dirname, "scenarios.ts"), "utf8");
const SCENARIOS_TOP_LEVEL = topLevelNames(SCENARIOS_SOURCE);

const OPEN_TO_CLOSE: Record<"(" | "{" | "[", string> = { "(": ")", "{": "}", "[": "]" };

function captured(match: RegExpMatchArray, index: number, what: string): string {
  const value = match[index];
  if (value === undefined) throw new Error(`no ${what} in ${JSON.stringify(match[0])}`);
  return value;
}

function skipString(source: string, quoteIndex: number): number {
  const quote = source[quoteIndex];
  let i = quoteIndex + 1;
  while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
  return i + 1;
}

function skipTemplate(source: string, backtickIndex: number): number {
  let i = backtickIndex + 1;
  while (i < source.length) {
    if (source[i] === "\\") i += 2;
    else if (source[i] === "`") return i + 1;
    else if (source[i] === "$" && source[i + 1] === "{") i = skipBalanced(source, i + 1);
    else i += 1;
  }
  return i;
}

function skipTrivial(source: string, i: number): number | undefined {
  if (source[i] === "/" && source[i + 1] === "/") {
    const end = source.indexOf("\n", i);
    return end === -1 ? source.length : end + 1;
  }
  if (source[i] === "/" && source[i + 1] === "*") {
    const end = source.indexOf("*/", i + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (source[i] === '"' || source[i] === "'") return skipString(source, i);
  if (source[i] === "`") return skipTemplate(source, i);
  return undefined;
}

function skipBalanced(source: string, openIndex: number): number {
  const open = source[openIndex];
  if (open !== "(" && open !== "{" && open !== "[") throw new Error(`no opening bracket at index ${openIndex} of the source`);
  const stack: string[] = [OPEN_TO_CLOSE[open]];
  let i = openIndex + 1;
  while (i < source.length && stack.length > 0) {
    const trivial = skipTrivial(source, i);
    if (trivial !== undefined) {
      i = trivial;
      continue;
    }
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") {
      stack.push(OPEN_TO_CLOSE[ch]);
      i += 1;
    } else if (ch === stack.at(-1) || ch === ")" || ch === "}" || ch === "]") {
      stack.pop();
      i += 1;
    } else {
      i += 1;
    }
  }
  return i;
}

function endOfStatement(source: string, from: number): number {
  let i = from;
  while (i < source.length) {
    const trivial = skipTrivial(source, i);
    if (trivial !== undefined) {
      i = trivial;
      continue;
    }
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") i = skipBalanced(source, i);
    else if (ch === ";") return i;
    else i += 1;
  }
  return i;
}

function topLevelNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(TOP_LEVEL_FUNCTION)) names.add(captured(match, 1, "function name"));
  for (const match of source.matchAll(TOP_LEVEL_CONST)) names.add(captured(match, 1, "const name"));
  return names;
}

function topLevelDeclaration(source: string, name: string): string | undefined {
  const fn = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, "m").exec(source);
  if (fn !== null) {
    const parenEnd = skipBalanced(source, matchEnd(fn) - 1);
    const braceStart = source.indexOf("{", parenEnd);
    return source.slice(fn.index, skipBalanced(source, braceStart));
  }
  const cst = new RegExp(`^(?:export\\s+)?const\\s+${name}\\b`, "m").exec(source);
  if (cst !== null) {
    const eq = source.indexOf("=", matchEnd(cst));
    if (eq === -1) return undefined;
    return source.slice(cst.index, endOfStatement(source, eq + 1));
  }
  return undefined;
}

function calledNames(source: string): Set<string> {
  return new Set([...source.matchAll(CALLED_NAME)].map((match) => captured(match, 1, "called name")));
}

function reachableText(source: string, seed: string, declared: Set<string>): string {
  const visited = new Set<string>();
  let combined = seed;
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of calledNames(combined)) {
      if (visited.has(name) || !declared.has(name)) continue;
      visited.add(name);
      const body = topLevelDeclaration(source, name);
      if (body !== undefined) {
        combined += `\n${body}`;
        grew = true;
      }
    }
  }
  return combined;
}

function fileImports(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(NAMED_IMPORT)) {
    const specifier = captured(match, 2, "import specifier");
    for (const part of captured(match, 1, "imported names").split(",")) {
      const trimmed = part.trim();
      if (trimmed === "") continue;
      const local = trimmed.split(/\s+as\s+/).at(-1);
      if (local === undefined) throw new Error(`no local name in import ${JSON.stringify(trimmed)}`);
      map.set(local.trim(), specifier);
    }
  }
  for (const match of source.matchAll(DEFAULT_IMPORT)) map.set(captured(match, 1, "default import name"), captured(match, 2, "import specifier"));
  return map;
}

function firstStringArg(source: string, from: number): string {
  let i = from;
  while (i < source.length && /\s/.test(source[i] ?? "")) i += 1;
  const quote = source[i];
  if (quote === "`") return source.slice(i + 1, skipTemplate(source, i) - 1);
  if (quote !== '"' && quote !== "'") return "";
  const end = skipString(source, i);
  return source.slice(i + 1, end - 1);
}

interface TestNode {
  fullName: string;
  bodyText: string;
}

function testsInFile(source: string): TestNode[] {
  const calls: { kind: string; title: string; start: number; end: number; bodyStart: number }[] = [];
  for (const match of source.matchAll(CALL_SITE)) {
    const openParen = matchEnd(match) - 1;
    const end = skipBalanced(source, openParen);
    calls.push({ kind: captured(match, 1, "call kind"), title: firstStringArg(source, openParen + 1), start: match.index, end, bodyStart: openParen });
  }
  return calls
    .filter((call) => call.kind === "it" || call.kind === "test")
    .map((test) => {
      const ancestry = calls.filter((call) => call.kind === "describe" && call.start < test.start && call.end > test.end).map((call) => call.title);
      return { fullName: [...ancestry, test.title].join(" "), bodyText: source.slice(test.bodyStart, test.end) };
    });
}

interface FileInfo {
  path: string;
  source: string;
  imports: Map<string, string>;
  topLevel: Set<string>;
  tests: TestNode[];
}

function listTestFiles(root: string): FileInfo[] {
  const srcDir = join(root, "src");
  const entries = readdirSync(srcDir, { recursive: true }) as string[];
  return entries
    .filter((entry) => entry.endsWith(".test.ts"))
    .map((entry) => {
      const source = readFileSync(join(srcDir, entry), "utf8");
      return { path: `src/${entry.split("\\").join("/")}`, source, imports: fileImports(source), topLevel: topLevelNames(source), tests: testsInFile(source) };
    });
}

function safePattern(text: string): RegExp {
  try {
    return new RegExp(text);
  } catch {
    return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
}

interface Selection {
  filters: string[];
  pattern: RegExp | undefined;
}

function selection(command: string): Selection | undefined {
  if (!VITEST_RUN.test(command.trim())) return undefined;
  const tokens = [...command.matchAll(TOKEN)].map((match) => match[1] ?? match[2] ?? captured(match, 3, "command token"));
  const filters: string[] = [];
  let patternText: string | undefined;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) throw new Error(`no token at position ${i} of ${JSON.stringify(command)}`);
    if (token === "npx" || token === "vitest" || token === "run") continue;
    if (token === "--config") {
      i += 1;
    } else if (token === "-t" || token === "--testNamePattern") {
      patternText = tokens[(i += 1)];
    } else if (!token.startsWith("-")) {
      filters.push(token);
    }
  }
  return { filters, pattern: patternText === undefined ? undefined : safePattern(patternText) };
}

function selectedTests(sel: Selection, files: FileInfo[]): { file: FileInfo; test: TestNode }[] {
  return files
    .filter((file) => sel.filters.length === 0 || sel.filters.some((filter) => file.path.includes(filter)))
    .flatMap((file) => file.tests.map((test) => ({ file, test })))
    .filter(({ test }) => sel.pattern === undefined || sel.pattern.test(test.fullName));
}

function spawnsBinOrSrc(text: string): boolean {
  for (const match of text.matchAll(SPAWN_SITE)) {
    const openParen = matchEnd(match) - 1;
    const args = text.slice(openParen, skipBalanced(text, openParen));
    if (/\b(?:BIN|SRC)\b/.test(args)) return true;
  }
  return false;
}

function callsAnotherSrcModule(text: string, imports: Map<string, string>): boolean {
  for (const [name, specifier] of imports) {
    if (!/^\.\/.+\.ts$/.test(specifier) || specifier === "./scenarios.ts") continue;
    if (new RegExp(`\\b${name}\\s*\\(`).test(text)) return true;
  }
  return false;
}

const executesCache = new Map<string, boolean>();

function scenariosExportExecutes(name: string): boolean {
  if (name === "holds") return false;
  const cached = executesCache.get(name);
  if (cached !== undefined) return cached;
  const body = topLevelDeclaration(SCENARIOS_SOURCE, name);
  const reached = body === undefined ? false : /\bexecute\s*\(/.test(reachableText(SCENARIOS_SOURCE, body, SCENARIOS_TOP_LEVEL));
  executesCache.set(name, reached);
  return reached;
}

function callsScenariosExport(text: string, imports: Map<string, string>): boolean {
  for (const [name, specifier] of imports) {
    if (specifier !== "./scenarios.ts") continue;
    if (new RegExp(`\\b${name}\\s*\\(`).test(text) && scenariosExportExecutes(name)) return true;
  }
  return false;
}

function testRunsShippedCode(file: FileInfo, test: TestNode): boolean {
  const combined = reachableText(file.source, test.bodyText, file.topLevel);
  return spawnsBinOrSrc(combined) || callsAnotherSrcModule(combined, file.imports) || callsScenariosExport(combined, file.imports);
}

function checkRunsShippedCode(command: string, files: FileInfo[]): boolean {
  const sel = selection(command);
  if (sel === undefined) return false;
  const tests = selectedTests(sel, files);
  return tests.length > 0 && tests.some(({ file, test }) => testRunsShippedCode(file, test));
}

function shapeOnlyLine(body: string, root: string): string {
  const files = listTestFiles(root);
  const flagged = checks(body).filter(({ command }) => !checkRunsShippedCode(command, files));
  if (flagged.length === 0) return "shape-only check (meter): would refuse nothing";
  return `shape-only check (meter): would refuse, ${flagged.map(({ at, command }) => `${at} (check: \`${quoted(command)}\`)`).join("; ")}`;
}

if (import.meta.main) process.stdout.write(`${shapeOnlyLine(await text(process.stdin), process.cwd())}\n`);
