import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { authoredTests, brief, capped, onDisk } from "./brief.ts";
import { runCheck } from "./check-runner.ts";
import { stageArgv, stageRefusals } from "./deny-list.ts";
import { checks, quoted } from "./ticket-shape.ts";

const STAGE = "builder";
const COMMANDS_CAP = 200;
export const TAIL_CAP = 8 * 1024;

function tailOf(text: string, limit: number): string {
  const bytes = Buffer.from(text);
  return bytes.length <= limit ? text : bytes.subarray(bytes.length - limit).toString("utf8").replace(/^�+/, "");
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

function transcriptEvents(stdout: string): unknown[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function sessionOf(stdout: string): string | undefined {
  let session: string | undefined;
  for (const event of transcriptEvents(stdout)) {
    const id = (event as { session_id?: unknown })?.session_id;
    if (typeof id === "string") session = id;
  }
  return session;
}

function writtenOutsideRepo(cwd: string, stdout: string): string | undefined {
  for (const event of transcriptEvents(stdout)) {
    const content = (event as { message?: { content?: unknown[] } })?.message?.content;
    for (const block of content ?? []) {
      const { type, name, input } = (block ?? {}) as { type?: string; name?: string; input?: { file_path?: unknown } };
      const path = input?.file_path;
      if (type === "tool_use" && (name === "Write" || name === "Edit") && typeof path === "string" && relative(cwd, path).startsWith("..")) return path;
    }
  }
  return undefined;
}

function build(ticket: string): { refusals: string[]; verdict: string } {
  const asked = spawnSync("gh", ["issue", "view", ticket, "--json", "body", "--jq", ".body"], { encoding: "utf8" });
  if (asked.status !== 0) return { refusals: [`ticket ${ticket} could not be read, so nothing was built`], verdict: "" };
  const body = asked.stdout;
  const tests = authoredTests();
  if (tests.length === 0) return { refusals: ["the branch carries no failing test from the author, so there is nothing to build against"], verdict: "" };
  const briefed = brief({ ticket, body, tests, read: onDisk });
  if (briefed.refusals.length > 0) return { refusals: briefed.refusals, verdict: "" };
  const commands = checks(body).map(({ command }) => command);
  const argv = stageArgv(commands, tests);
  const unfenced = stageRefusals(STAGE, argv);
  if (unfenced.length > 0) return { refusals: unfenced, verdict: "" };
  const cwd = process.cwd();
  const first = spawnSync("claude", [...argv, "--output-format", "stream-json", "--verbose"], { input: handedOn(briefed.text, commands), encoding: "utf8" });
  if (first.status !== 0) return { refusals: [ended(first)], verdict: "" };
  const strayFirst = writtenOutsideRepo(cwd, first.stdout);
  if (strayFirst !== undefined) return { refusals: [`the ${STAGE} wrote outside the repo: ${strayFirst}`], verdict: "" };
  const session = sessionOf(first.stdout);
  if (session === undefined) return { refusals: [`the ${STAGE} named no session to resume`], verdict: "" };
  const red = redOutput(commands);
  if (red === "") return { refusals: [], verdict: "green after the build" };
  const repair = spawnSync("claude", [...argv, "--resume", session, "--output-format", "stream-json", "--verbose"], { input: repaired(red), encoding: "utf8" });
  if (repair.status !== 0) return { refusals: [ended(repair)], verdict: "" };
  const strayRepair = writtenOutsideRepo(cwd, repair.stdout);
  if (strayRepair !== undefined) return { refusals: [`the ${STAGE} wrote outside the repo: ${strayRepair}`], verdict: "" };
  if (redOutput(commands) !== "") return { refusals: ["the checks are still red after the repair round"], verdict: "" };
  return { refusals: [], verdict: "green after the repair round" };
}

if (import.meta.main) {
  const { refusals, verdict } = build(process.argv[2]);
  for (const refusal of refusals) console.error(refusal);
  if (refusals.length === 0) console.log(verdict);
  process.exit(refusals.length > 0 ? 1 : 0);
}
