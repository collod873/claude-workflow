import { relative, resolve } from "node:path";
import { capped, yourChecks } from "./brief.ts";
import { runCheck, type Shell } from "./check-runner.ts";
import { OPEN_SHELL, STATIC } from "./fence.ts";
import { runStage, type Opened, type Outcome, type Stage } from "./stage.ts";
import { checks, quoted } from "./ticket-shape.ts";

const STAGE = "test author";
const AUTHORED = ".test.ts";
const FIXTURES = "src/scenarios.ts";
const RAN = /[\w./-]+\.test\.ts/g;
export const REFUSALS_CAP = 4 * 1024;
const WROTE_NOTHING = "the author wrote nothing, so it wrote no test for any criterion";

function judged(body: string, cwd: string, run?: Shell): { refusals: string[]; ran: Set<string> } {
  const ran = new Set<string>();
  const refusals = checks(body).flatMap(({ at, command }) => {
    const { passed, output } = runCheck(command, cwd, run);
    for (const [file] of output.matchAll(RAN)) ran.add(relative(cwd, resolve(cwd, file)));
    return passed ? [`${at} has no failing test: \`${quoted(command)}\` already passes`] : [];
  });
  return { refusals, ran };
}

export function uncovered(body: string, cwd: string, run?: Shell): string[] {
  return judged(body, cwd, run).refusals;
}

export function handedOn(briefed: string, commands: string[]): string {
  const goodTest = [
    "A good test fails now and passes only once the behaviour is really there:",
    "- Assert the exact thing the criterion is about: the specific text, value, file or call. Never a phrase the code prints either way.",
    '- When a criterion says "instead of" or "no longer", also assert the old behaviour is gone.',
    "- Before you finish, picture the laziest wrong build that would pass each test. If one exists, tighten the test until it can't.",
  ].join("\n");
  return [
    briefed,
    "## What to write",
    `Write one failing test for each criterion above, and write nothing else. ${yourChecks(commands)} You are done when every one of them fails; when you finish, the machine runs them again and hands you back any that pass.`,
    goodTest,
    "A claimed file not written yet already counts as red, so don't build it.",
    `\`${STATIC}\` runs the gates your tests must pass: no comments, no em dash, and no copied code, so build on the helpers in \`src/scenarios.ts\`. Its typecheck and unused gates stay red on a claimed file not written yet; that red is the builder's.`,
    "",
  ].join("\n\n");
}

export function refused(refusals: string[]): string {
  return ["Your tests were refused:", capped(refusals.map((refusal) => `- ${refusal}`).join("\n"), REFUSALS_CAP), "Write a failing test each check runs, for every criterion named.", ""].join("\n\n");
}

function author(opened: Opened): Outcome {
  const tests = () => opened.wrote().filter((path) => path.endsWith(AUTHORED));
  const judge = () => {
    if (tests().length === 0) return [WROTE_NOTHING];
    const { refusals, ran } = judged(opened.body, process.cwd());
    const untested = opened.wrote().filter((path) => !path.endsWith(AUTHORED) && path !== FIXTURES);
    const unrun = tests().filter((path) => !ran.has(path));
    const all = [...refusals, ...untested.map((path) => `${path} is not a test, so delete it`), ...unrun.map((path) => `${path} runs under no check, so delete it`)];
    return all.length > 0 ? all : undefined;
  };
  const { spent, red } = opened.handBack(handedOn(opened.briefed, opened.commands), judge, refused);
  if (spent.refusal !== undefined) return { stop: "modelRun", refusals: [spent.refusal] };
  if (red !== undefined) return { stop: "noTest", refusals: red };
  const branch = `ticket/${opened.ticket}`;
  return {
    verdict: `has a failing test for each criterion, ${tests().length} written on ${branch}`,
    commit: { message: `Hold #${opened.ticket} to one failing test per criterion`, branch },
  };
}

const AUTHOR: Stage = {
  name: STAGE,
  bin: "test-author",
  undone: "no test was authored",
  reach: OPEN_SHELL,
  work: author,
};

if (import.meta.main) {
  const ticket = process.argv[2];
  if (ticket === undefined) throw new Error("no ticket number in the arguments to the test author");
  process.exit(runStage(AUTHOR, ticket));
}
