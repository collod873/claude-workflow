import { authoredTests, yourChecks } from "./brief.ts";
import { runCheck } from "./check-runner.ts";
import { runStage, type Opened, type Outcome, type Stage } from "./stage.ts";
import type { Stop } from "./stops.ts";
import { claims } from "./ticket-shape.ts";

export const TAIL_CAP = 8 * 1024;

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
    "",
  ].join("\n\n");
}

export function repaired(output: string): string {
  return ["Your checks are still red. The end of their output:", tailOf(output, TAIL_CAP), "Fix the build so they pass.", ""].join("\n\n");
}

export function redOutput(commands: string[]): string {
  return commands
    .map((command) => runCheck(command, process.cwd()))
    .filter(({ passed }) => !passed)
    .map(({ output }) => output)
    .join("\n");
}

function withAside(verdict: string, aside: string[]): string {
  return aside.length === 0 ? verdict : `${verdict}, having set aside ${aside.join(", ")}`;
}

function build(opened: Opened): Outcome {
  const { ticket, briefed, commands, aside } = opened;
  const commit = { message: `Build #${ticket} against its failing tests` };
  const red = (stop: Stop, refusal: string): Outcome => ({ stop, refusals: [withAside(refusal, aside)], commit });
  const green = (verdict: string): Outcome => ({ verdict: withAside(verdict, aside), commit });
  const first = opened.spend(handedOn(briefed, commands));
  if (first.refusal !== undefined) return red("modelRun", first.refusal);
  if (first.session === undefined) return red("modelRun", "the builder named no session to resume");
  const output = redOutput(commands);
  if (output === "") return green("green after the build");
  const repair = opened.spend(repaired(output), first.session);
  if (repair.refusal !== undefined) return red("modelRun", repair.refusal);
  return redOutput(commands) === "" ? green("green after the repair round") : red("buildRed", "the checks are still red after the repair round");
}

const BUILDER: Stage = {
  name: "builder",
  bin: "build",
  undone: "nothing was built",
  clean: true,
  tests: { found: authoredTests, missing: "the branch carries no failing test from the author, so there is nothing to build against" },
  keeps: (path, { tests, body }) => !tests.includes(path) && claims(body).includes(path),
  work: build,
};

if (import.meta.main) process.exit(runStage(BUILDER, process.argv[2]));
