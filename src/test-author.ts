import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { brief, capped, onDisk } from "./brief.ts";
import { RAN_NO_TESTS, runCheck, type Shell } from "./check-runner.ts";
import { denyFlags, stageRefusals } from "./deny-list.ts";
import { checks, claims, quoted } from "./ticket-shape.ts";

const STAGE = "test author";
const MODEL = "sonnet";
const WRITES = ["Read", "Edit", "Write"];
const COMMANDS_CAP = 200;
const STATIC = "bin/check static";
const UNIMPORTED = /Cannot find module '(\.[^']+)' imported from (.+?)\s*$/gm;
const AUTHORED = ".test.ts";
const UNTRACKED = "??";

function awaitsTheBuild(body: string, cwd: string, output: string): boolean {
  const missing = [...output.matchAll(UNIMPORTED)].map(([, module, importer]) => relative(cwd, resolve(cwd, dirname(importer), module)));
  const unwritten = new Set(claims(body).filter((path) => !existsSync(join(cwd, path))));
  return missing.length > 0 && missing.every((path) => unwritten.has(path));
}

export function uncovered(body: string, cwd: string, run?: Shell): string[] {
  return checks(body).flatMap(({ at, command }) => {
    const { passed, why, output } = runCheck(command, cwd, run);
    if (passed) return [`${at} has no failing test: \`${quoted(command)}\` already passes`];
    if (why !== RAN_NO_TESTS || awaitsTheBuild(body, cwd, output)) return [];
    return [`${at} has no failing test: \`${quoted(command)}\` ran no tests`];
  });
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

function setAside(cwd: string, before: Map<string, string>, ticket: string): number {
  const logs = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8" }).stdout.trim();
  const kept = join(logs, "machine-logs", `test-author-${ticket}-set-aside`);
  const outside = [...changed(cwd)].filter(([path]) => !before.has(path) && !path.endsWith(AUTHORED));
  if (outside.length === 0) return 0;
  rmSync(kept, { recursive: true, force: true });
  for (const [path, status] of outside) {
    const written = join(cwd, path);
    mkdirSync(dirname(join(kept, path)), { recursive: true });
    if (existsSync(written)) cpSync(written, join(kept, path));
    if (status === UNTRACKED) rmSync(written, { force: true });
    else spawnSync("git", ["checkout", "--quiet", "--", path], { cwd });
  }
  return outside.length;
}

function stageArgv(commands: string[]): string[] {
  return [
    "--print",
    "--model",
    MODEL,
    "--setting-sources",
    "",
    "--allowedTools",
    [...WRITES, ...[...commands, STATIC].map((command) => `Bash(${command})`)].join(","),
    ...denyFlags(),
  ];
}

export function handedOn(briefed: string, commands: string[]): string {
  return [
    briefed,
    "## What to write",
    `Write one failing test for each criterion above, and write nothing else. Your check commands are ${capped(commands.map((command) => `\`${command}\``).join(", "), COMMANDS_CAP)}.`,
    "Each ends red naming the behaviour its criterion asks for. A criterion with no failing test ends this stage red.",
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
  const argv = stageArgv(commands);
  const unfenced = stageRefusals(STAGE, argv);
  if (unfenced.length > 0) return { refusals: unfenced, setAside: 0 };
  const cwd = process.cwd();
  const before = changed(cwd);
  const spent = spawnSync("claude", argv, { input: handedOn(briefed.text, commands), encoding: "utf8" });
  const aside = setAside(cwd, before, ticket);
  if (spent.status !== 0) return { refusals: [`the ${STAGE} ended ${spent.status}: ${quoted((spent.stderr || spent.stdout).trim().split("\n")[0])}`], setAside: aside };
  return { refusals: uncovered(body, cwd), setAside: aside };
}

if (import.meta.main) {
  const { refusals, setAside: aside } = authorRefusals(process.argv[2]);
  for (const refusal of refusals) console.error(refusal);
  console.log(aside);
  process.exit(refusals.length > 0 ? 1 : 0);
}
