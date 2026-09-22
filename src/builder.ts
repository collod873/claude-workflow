import { spawnSync } from "node:child_process";
import { authoredTests, brief, capped, onDisk } from "./brief.ts";
import { runCheck } from "./check-runner.ts";
import { denyFlags, stageRefusals } from "./deny-list.ts";
import { checks, quoted } from "./ticket-shape.ts";

const STAGE = "builder";
const MODEL = "sonnet";
const TOOLS = ["Read", "Edit", "Write", "Bash"];
const COMMANDS_CAP = 200;
export const TAIL_CAP = 8 * 1024;

function tailOf(text: string, limit: number): string {
  const bytes = Buffer.from(text);
  return bytes.length <= limit ? text : bytes.subarray(bytes.length - limit).toString("utf8").replace(/^�+/, "");
}

function stageArgv(tests: string[]): string[] {
  const [flag, denied] = denyFlags();
  const untouchable = tests.flatMap((test) => [`Edit(${test})`, `Write(${test})`]);
  return ["--print", "--model", MODEL, "--setting-sources", "", "--allowedTools", TOOLS.join(","), flag, [denied, ...untouchable].join(",")];
}

export function handedOn(briefed: string, commands: string[]): string {
  return [
    briefed,
    "## What to build",
    `Build what the ticket asks for until the acceptance test passes. Your check commands are ${capped(commands.map((command) => `\`${command}\``).join(", "), COMMANDS_CAP)}.`,
    "`bin/check static` runs the gates your code must pass: no comments, no em dash, no copied code, and every export used by a part.",
    "",
  ].join("\n\n");
}

export function repaired(output: string): string {
  return ["Your checks are still red. The end of their output:", tailOf(output, TAIL_CAP), "Fix the build so they pass.", ""].join("\n\n");
}

function redOutput(commands: string[]): string {
  return commands
    .map((command) => runCheck(command, process.cwd()))
    .filter(({ passed }) => !passed)
    .map(({ output }) => output)
    .join("\n");
}

function ended(spent: ReturnType<typeof spawnSync>): string {
  return `the ${STAGE} ended ${spent.status}: ${quoted(String(spent.stderr || spent.stdout).trim().split("\n")[0])}`;
}

function sessionOf(stdout: string): string | undefined {
  try {
    const { session_id: session } = JSON.parse(stdout) as { session_id?: unknown };
    return typeof session === "string" ? session : undefined;
  } catch {
    return undefined;
  }
}

function build(ticket: string): { refusals: string[]; verdict: string } {
  const asked = spawnSync("gh", ["issue", "view", ticket, "--json", "body", "--jq", ".body"], { encoding: "utf8" });
  if (asked.status !== 0) return { refusals: [`ticket ${ticket} could not be read, so nothing was built`], verdict: "" };
  const body = asked.stdout;
  const tests = authoredTests();
  const briefed = brief({ ticket, body, tests, read: onDisk });
  if (briefed.refusals.length > 0) return { refusals: briefed.refusals, verdict: "" };
  const commands = checks(body).map(({ command }) => command);
  const argv = stageArgv(tests);
  const unfenced = stageRefusals(STAGE, argv);
  if (unfenced.length > 0) return { refusals: unfenced, verdict: "" };
  const first = spawnSync("claude", [...argv, "--output-format", "json"], { input: handedOn(briefed.text, commands), encoding: "utf8" });
  if (first.status !== 0) return { refusals: [ended(first)], verdict: "" };
  const session = sessionOf(first.stdout);
  if (session === undefined) return { refusals: [`the ${STAGE} named no session to resume`], verdict: "" };
  const red = redOutput(commands);
  if (red === "") return { refusals: [], verdict: "green after the build" };
  const repair = spawnSync("claude", [...argv, "--resume", session], { input: repaired(red), encoding: "utf8" });
  if (repair.status !== 0) return { refusals: [ended(repair)], verdict: "" };
  return { refusals: [], verdict: redOutput(commands) === "" ? "green after the repair round" : "still red after the repair round" };
}

if (import.meta.main) {
  const { refusals, verdict } = build(process.argv[2]);
  for (const refusal of refusals) console.error(refusal);
  if (refusals.length === 0) console.log(verdict);
  process.exit(refusals.length > 0 ? 1 : 0);
}
