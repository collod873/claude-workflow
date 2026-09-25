import { resolve } from "node:path";
import { authoredTests, onDisk, yourChecks } from "./brief.ts";
import { runCheck } from "./check-runner.ts";
import { CHECK } from "./fence.ts";
import { ROUNDS, runStage, type Opened, type Outcome, type Stage } from "./stage.ts";
import type { Stop } from "./stops.ts";
import { claims } from "./ticket-shape.ts";

export const TAIL_CAP = 8 * 1024;
const LOGGED = /; log (.+?)\s*$/m;
export const HANDS_BACK = `When you finish, the machine runs \`${CHECK}\`, shown above, and hands you anything red. Build to pass it.`;

export function tailOf(text: string, limit: number): string {
  const bytes = Buffer.from(text);
  return bytes.length <= limit ? text : bytes.subarray(bytes.length - limit).toString("utf8").replace(/^�+/, "");
}

export function handedOn(briefed: string, commands: string[]): string {
  return [
    briefed,
    "## What to build",
    `Build what the ticket asks for until the acceptance test passes. ${yourChecks(commands)}`,
    "`bin/check static` runs the gates your code must pass: no comments, no em dash, no copied code, and every export used by a part.",
    HANDS_BACK,
    "",
  ].join("\n\n");
}

export function repaired(output: string): string {
  return [`Your checks or \`${CHECK}\` are still red. The end of their output:`, tailOf(output, TAIL_CAP), "Make them pass.", ""].join("\n\n");
}

function redOutput(commands: string[]): string {
  return commands
    .map((command) => runCheck(command, process.cwd()))
    .filter(({ passed }) => !passed)
    .map(({ output }) => output)
    .join("\n");
}

function checkRed(): string {
  const { passed, output } = runCheck(CHECK, process.cwd());
  if (passed) return "";
  const log = LOGGED.exec(output)?.[1];
  return [output.trim(), log === undefined ? "" : (onDisk(resolve(log)) ?? "")].join("\n");
}

export const stillRed = (commands: string[]) => [checkRed(), redOutput(commands)].filter((output) => output !== "").join("\n");

const roundsHandedBack = (rounds: number) => `${rounds} of ${ROUNDS} rounds handed back`;

function withAside(verdict: string, aside: string[]): string {
  return aside.length === 0 ? verdict : `${verdict}, having set aside ${aside.join(", ")}`;
}

function build(opened: Opened): Outcome {
  const { ticket, briefed, commands, aside } = opened;
  const commit = { message: `Build #${ticket} against its failing tests` };
  const red = (stop: Stop, refusal: string): Outcome => ({ stop, refusals: [withAside(refusal, aside)], commit });
  const green = (verdict: string): Outcome => ({ verdict: withAside(verdict, aside), commit });
  const built = opened.handBack(handedOn(briefed, commands), () => stillRed(commands) || undefined, repaired);
  if (built.spent.refusal !== undefined) return red("modelRun", built.spent.refusal);
  if (built.red !== undefined) return red("buildRed", `the checks are still red after ${roundsHandedBack(ROUNDS)}`);
  return green(built.rounds === 0 ? "green after the build" : `green after ${roundsHandedBack(built.rounds)}`);
}

const BUILDER: Stage = {
  name: "builder",
  bin: "build",
  undone: "nothing was built",
  clean: true,
  gated: true,
  tests: { found: authoredTests, missing: "the branch carries no failing test from the author, so there is nothing to build against" },
  keeps: (path, { tests, body }) => !tests.includes(path) && claims(body).includes(path),
  work: build,
};

if (import.meta.main) process.exit(runStage(BUILDER, process.argv[2]));
