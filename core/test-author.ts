import { spawnSync } from "node:child_process";
import { brief, capped, onDisk } from "./brief.ts";
import { RAN_NO_TESTS, runCheck, type Shell } from "./check-runner.ts";
import { denyFlags, stageRefusals } from "./deny-list.ts";
import { checks, quoted } from "./ticket-shape.ts";

const STAGE = "test author";
const MODEL = "sonnet";
const WRITES = ["Read", "Edit", "Write"];
const COMMANDS_CAP = 200;

export function uncovered(body: string, cwd: string, run?: Shell): string[] {
  return checks(body).flatMap(({ at, command }) => {
    const { passed, why } = runCheck(command, cwd, run);
    if (passed) return [`${at} has no failing test: \`${quoted(command)}\` already passes`];
    return why === RAN_NO_TESTS ? [`${at} has no failing test: \`${quoted(command)}\` ran no tests`] : [];
  });
}

function stageArgv(commands: string[]): string[] {
  return [
    "--print",
    "--model",
    MODEL,
    "--setting-sources",
    "",
    "--allowedTools",
    [...WRITES, ...commands.map((command) => `Bash(${command})`)].join(","),
    ...denyFlags(),
  ];
}

export function handedOn(briefed: string, commands: string[]): string {
  return [
    briefed,
    "## What to write",
    `Write one failing test for each criterion above, and write nothing else. Your check commands are ${capped(commands.map((command) => `\`${command}\``).join(", "), COMMANDS_CAP)}.`,
    "Each ends red naming the behaviour its criterion asks for. A criterion with no failing test ends this stage red.",
    "",
  ].join("\n\n");
}

function authorRefusals(ticket: string): string[] {
  const asked = spawnSync("gh", ["issue", "view", ticket, "--json", "body", "--jq", ".body"], { encoding: "utf8" });
  if (asked.status !== 0) return [`ticket ${ticket} could not be read, so no test was authored`];
  const body = asked.stdout;
  const briefed = brief({ ticket, body, tests: [], read: onDisk });
  if (briefed.refusals.length > 0) return briefed.refusals;
  const commands = checks(body).map(({ command }) => command);
  const argv = stageArgv(commands);
  const unfenced = stageRefusals(STAGE, argv);
  if (unfenced.length > 0) return unfenced;
  const spent = spawnSync("claude", argv, { input: handedOn(briefed.text, commands), encoding: "utf8" });
  if (spent.status !== 0) return [`the ${STAGE} ended ${spent.status}: ${quoted((spent.stderr || spent.stdout).trim().split("\n")[0])}`];
  return uncovered(body, process.cwd());
}

if (import.meta.main) {
  const refusals = authorRefusals(process.argv[2]);
  for (const refusal of refusals) console.error(refusal);
  process.exit(refusals.length > 0 ? 1 : 0);
}
