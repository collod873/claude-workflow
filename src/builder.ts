import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { authoredTests, brief, capped, onDisk } from "./brief.ts";
import { runCheck } from "./check-runner.ts";
import { stageArgv, stageRefusals, transcriptEvents, writtenOutsideRepo } from "./deny-list.ts";
import { changed, keptFor, setAside } from "./test-author.ts";
import { checks, claims, quoted } from "./ticket-shape.ts";

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

function withAside(verdict: string, aside: string[]): string {
  return aside.length === 0 ? verdict : `${verdict}, having set aside ${aside.join(", ")}`;
}

function sessionOf(stdout: string): string | undefined {
  let session: string | undefined;
  for (const event of transcriptEvents(stdout)) {
    const id = (event as { session_id?: unknown })?.session_id;
    if (typeof id === "string") session = id;
  }
  return session;
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
  const claimed = new Set([...tests, ...claims(body)]);
  const kept = keptFor(cwd, STAGE, ticket);
  rmSync(kept, { recursive: true, force: true });
  const before = changed(cwd);
  const aside: string[] = [];
  const spend = (extra: string[], input: string) => {
    const spent = spawnSync("claude", [...argv, ...extra, "--output-format", "stream-json", "--verbose"], { input, encoding: "utf8" });
    for (const path of setAside(cwd, [...changed(cwd)].filter(([written]) => !before.has(written) && !claimed.has(written)), kept)) if (!aside.includes(path)) aside.push(path);
    if (spent.status !== 0) return { spent, refusal: withAside(ended(spent), aside) };
    const stray = writtenOutsideRepo(cwd, spent.stdout);
    return { spent, refusal: stray === undefined ? undefined : withAside(`the ${STAGE} wrote outside the repo: ${stray}`, aside) };
  };
  const first = spend([], handedOn(briefed.text, commands));
  if (first.refusal !== undefined) return { refusals: [first.refusal], verdict: "" };
  const session = sessionOf(first.spent.stdout);
  if (session === undefined) return { refusals: [withAside(`the ${STAGE} named no session to resume`, aside)], verdict: "" };
  const red = redOutput(commands);
  if (red === "") return { refusals: [], verdict: withAside("green after the build", aside) };
  const repair = spend(["--resume", session], repaired(red));
  if (repair.refusal !== undefined) return { refusals: [repair.refusal], verdict: "" };
  if (redOutput(commands) !== "") return { refusals: [withAside("the checks are still red after the repair round", aside)], verdict: "" };
  return { refusals: [], verdict: withAside("green after the repair round", aside) };
}

if (import.meta.main) {
  const { refusals, verdict } = build(process.argv[2]);
  for (const refusal of refusals) console.error(refusal);
  if (refusals.length === 0) console.log(verdict);
  process.exit(refusals.length > 0 ? 1 : 0);
}
