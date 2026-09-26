import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { capped, yourChecks } from "./brief.ts";
import { RAN_NO_TESTS, runCheck, type Shell } from "./check-runner.ts";
import { STATIC } from "./fence.ts";
import { runStage, type Opened, type Outcome, type Stage } from "./stage.ts";
import { checks, claims, quoted } from "./ticket-shape.ts";

const STAGE = "test author";
const UNIMPORTED = /Cannot find module '(\.[^']+)' imported from (.+?)\s*$/gm;
const AUTHORED = ".test.ts";
const FIXTURES = "src/scenarios.ts";
const RAN = /[\w./-]+\.test\.ts/g;
export const REFUSALS_CAP = 4 * 1024;
const WROTE_NOTHING = "the author wrote nothing, so it wrote no test for any criterion";

function awaitsTheBuild(body: string, cwd: string, output: string): boolean {
  const missing = [...output.matchAll(UNIMPORTED)].map(([line, module, importer]) => {
    if (module === undefined || importer === undefined) throw new Error(`no module or importer in ${JSON.stringify(line)}`);
    return relative(cwd, resolve(cwd, dirname(importer), module));
  });
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

export function handedOn(briefed: string, commands: string[]): string {
  return [
    briefed,
    "## What to write",
    `Write one failing test for each criterion above, and write nothing else. ${yourChecks(commands)}`,
    "Each ends red naming the behaviour its criterion asks for. A check that passes, or runs no tests, is refused and handed back to you.",
    `Anything you write outside test files and \`${FIXTURES}\`, and any test your check commands do not run, is removed before the checks judge, so a prototype proves nothing; a claimed file not written yet already counts as red.`,
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
    opened.setAside(tests().filter((path) => !ran.has(path)));
    return refusals.length > 0 ? refusals : undefined;
  };
  const { spent, red } = opened.handBack(handedOn(opened.briefed, opened.commands), judge, refused);
  if (spent.refusal !== undefined) return { stop: "modelRun", refusals: [spent.refusal] };
  if (red !== undefined) return { stop: "noTest", refusals: red };
  const branch = `ticket/${opened.ticket}`;
  const aside = opened.aside.length === 0 ? "" : `; set aside ${opened.aside.length} files the checks did not judge`;
  return {
    verdict: `has a failing test for each criterion, ${tests().length} written on ${branch}${aside}`,
    commit: { message: `Hold #${opened.ticket} to one failing test per criterion`, branch },
  };
}

const AUTHOR: Stage = {
  name: STAGE,
  bin: "test-author",
  undone: "no test was authored",
  keeps: (path) => path.endsWith(AUTHORED) || path === FIXTURES,
  work: author,
};

if (import.meta.main) {
  const ticket = process.argv[2];
  if (ticket === undefined) throw new Error("no ticket number in the arguments to the test author");
  process.exit(runStage(AUTHOR, ticket));
}
