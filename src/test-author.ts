import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { brief, capped, onDisk } from "./brief.ts";
import { RAN_NO_TESTS, runCheck, type Shell } from "./check-runner.ts";
import { STATIC, stageArgv, stageRefusals } from "./deny-list.ts";
import { checks, claims, quoted } from "./ticket-shape.ts";

const STAGE = "test author";
const COMMANDS_CAP = 200;
const UNIMPORTED = /Cannot find module '(\.[^']+)' imported from (.+?)\s*$/gm;
const AUTHORED = ".test.ts";
const FIXTURES = "src/scenarios.ts";
const UNTRACKED = "??";
const RAN = /[\w./-]+\.test\.ts/g;

function transcriptPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const content = (event as { message?: { content?: unknown[] } })?.message?.content;
    for (const block of content ?? []) {
      const { type, name, input } = (block ?? {}) as { type?: string; name?: string; input?: { file_path?: unknown } };
      if (type === "tool_use" && (name === "Write" || name === "Edit") && typeof input?.file_path === "string") paths.push(input.file_path);
    }
  }
  return paths;
}

function writtenOutsideRepo(cwd: string, stdout: string): string | undefined {
  return transcriptPaths(stdout).find((path) => relative(cwd, path).startsWith(".."));
}

function awaitsTheBuild(body: string, cwd: string, output: string): boolean {
  const missing = [...output.matchAll(UNIMPORTED)].map(([, module, importer]) => relative(cwd, resolve(cwd, dirname(importer), module)));
  const unwritten = new Set(claims(body).filter((path) => !existsSync(join(cwd, path))));
  return missing.length > 0 && missing.every((path) => unwritten.has(path));
}

function judged(body: string, cwd: string, run?: Shell): { refusals: string[]; ran: Set<string> } {
  const ran = new Set<string>();
  const refusals = checks(body).flatMap(({ at, command }) => {
    const { passed, why, output } = runCheck(command, cwd, run);
    for (const [file] of output.matchAll(RAN)) ran.add(relative(cwd, resolve(cwd, file)));
    if (passed) return [`${at} has no failing test: \`${quoted(command)}\` already passes`];
    if (why !== RAN_NO_TESTS || awaitsTheBuild(body, cwd, output)) return [];
    return [`${at} has no failing test: \`${quoted(command)}\` ran no tests`];
  });
  return { refusals, ran };
}

export function uncovered(body: string, cwd: string, run?: Shell): string[] {
  return judged(body, cwd, run).refusals;
}

function changed(cwd: string): Map<string, string> {
  const entries = spawnSync("git", ["status", "--porcelain", "-z", "-uall"], { cwd, encoding: "utf8" }).stdout.split("\0");
  const found = new Map<string, string>();
  for (let at = 0; at < entries.length; at++) {
    const entry = entries[at];
    if (entry.length < 4) continue;
    found.set(entry.slice(3), entry.slice(0, 2));
    if (/^[RC]/.test(entry)) at++;
  }
  return found;
}

function keptFor(cwd: string, ticket: string): string {
  const logs = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8" }).stdout.trim();
  return join(logs, "machine-logs", `test-author-${ticket}-set-aside`);
}

function setAside(cwd: string, outside: [string, string][], kept: string): number {
  for (const [path, status] of outside) {
    const written = join(cwd, path);
    mkdirSync(dirname(join(kept, path)), { recursive: true });
    if (existsSync(written)) cpSync(written, join(kept, path));
    if (status === UNTRACKED) rmSync(written, { force: true });
    else spawnSync("git", ["checkout", "--quiet", "--", path], { cwd });
  }
  return outside.length;
}

export function handedOn(briefed: string, commands: string[]): string {
  return [
    briefed,
    "## What to write",
    `Write one failing test for each criterion above, and write nothing else. Your check commands are ${capped(commands.map((command) => `\`${command}\``).join(", "), COMMANDS_CAP)}.`,
    "Each ends red naming the behaviour its criterion asks for. A criterion with no failing test ends this stage red.",
    `Anything you write outside test files and \`${FIXTURES}\`, and any test your check commands do not run, is removed before the checks judge, so a prototype proves nothing; a claimed file not written yet already counts as red.`,
    `\`${STATIC}\` runs the gates your tests must pass: no comments, no em dash, and no copied code, so build on the helpers in \`src/scenarios.ts\`. Its typecheck and unused gates stay red on a claimed file not written yet; that red is the builder's.`,
    "",
  ].join("\n\n");
}

function authorRefusals(ticket: string): { refusals: string[]; setAside: number } {
  const asked = spawnSync("gh", ["issue", "view", ticket, "--json", "body", "--jq", ".body"], { encoding: "utf8" });
  if (asked.status !== 0) return { refusals: [`ticket ${ticket} could not be read, so no test was authored`], setAside: 0 };
  const body = asked.stdout;
  const briefed = brief({ ticket, body, tests: [], read: onDisk });
  if (briefed.refusals.length > 0) return { refusals: briefed.refusals, setAside: 0 };
  const commands = checks(body).map(({ command }) => command);
  const argv = [...stageArgv(commands), "--output-format", "stream-json", "--verbose"];
  const unfenced = stageRefusals(STAGE, argv);
  if (unfenced.length > 0) return { refusals: unfenced, setAside: 0 };
  const cwd = process.cwd();
  const kept = keptFor(cwd, ticket);
  rmSync(kept, { recursive: true, force: true });
  const before = changed(cwd);
  const spent = spawnSync("claude", argv, { input: handedOn(briefed.text, commands), encoding: "utf8" });
  const stray = writtenOutsideRepo(cwd, spent.stdout);
  if (stray !== undefined) return { refusals: [`the ${STAGE} wrote outside the repo: ${stray}`], setAside: 0 };
  const wrote = () => [...changed(cwd)].filter(([path]) => !before.has(path));
  const outside = setAside(cwd, wrote().filter(([path]) => !path.endsWith(AUTHORED) && path !== FIXTURES), kept);
  if (spent.status !== 0) return { refusals: [`the ${STAGE} ended ${spent.status}: ${quoted((spent.stderr || spent.stdout).trim().split("\n")[0])}`], setAside: outside };
  if (!wrote().some(([path]) => path.endsWith(AUTHORED))) return { refusals: ["the author wrote nothing, so it wrote no test for any criterion"], setAside: outside };
  const { refusals, ran } = judged(body, cwd);
  const unrun = setAside(cwd, wrote().filter(([path]) => path.endsWith(AUTHORED) && !ran.has(path)), kept);
  return { refusals, setAside: outside + unrun };
}

if (import.meta.main) {
  const { refusals, setAside: aside } = authorRefusals(process.argv[2]);
  for (const refusal of refusals) console.error(refusal);
  console.log(aside);
  process.exit(refusals.length > 0 ? 1 : 0);
}
