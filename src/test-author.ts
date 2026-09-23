import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { yourChecks } from "./brief.ts";
import { RAN_NO_TESTS, runCheck, type Shell } from "./check-runner.ts";
import { STATIC } from "./fence.ts";
import { runStage, type Opened, type Outcome, type Stage } from "./stage.ts";
import { checks, claims, quoted } from "./ticket-shape.ts";

const STAGE = "test author";
const UNIMPORTED = /Cannot find module '(\.[^']+)' imported from (.+?)\s*$/gm;
const AUTHORED = ".test.ts";
const FIXTURES = "src/scenarios.ts";
const RAN = /[\w./-]+\.test\.ts/g;

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

export function handedOn(briefed: string, commands: string[]): string {
  return [
    briefed,
    "## What to write",
    `Write one failing test for each criterion above, and write nothing else. ${yourChecks(commands)}`,
    "Each ends red naming the behaviour its criterion asks for. A criterion with no failing test ends this stage red.",
    `Anything you write outside test files and \`${FIXTURES}\`, and any test your check commands do not run, is removed before the checks judge, so a prototype proves nothing; a claimed file not written yet already counts as red.`,
    `\`${STATIC}\` runs the gates your tests must pass: no comments, no em dash, and no copied code, so build on the helpers in \`src/scenarios.ts\`. Its typecheck and unused gates stay red on a claimed file not written yet; that red is the builder's.`,
    "",
  ].join("\n\n");
}

function author(opened: Opened): Outcome {
  const spent = opened.spend(handedOn(opened.briefed, opened.commands));
  if (spent.refusal !== undefined) return { refusals: [spent.refusal] };
  const tests = () => opened.wrote().filter((path) => path.endsWith(AUTHORED));
  if (tests().length === 0) return { refusals: ["the author wrote nothing, so it wrote no test for any criterion"] };
  const { refusals, ran } = judged(opened.body, process.cwd());
  opened.setAside(tests().filter((path) => !ran.has(path)));
  if (refusals.length > 0) return { refusals };
  const branch = `ticket/${opened.ticket}`;
  const aside = opened.aside.length === 0 ? "" : `; set aside ${opened.aside.length} files the checks did not judge`;
  return {
    refusals: [],
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

if (import.meta.main) process.exit(runStage(AUTHOR, process.argv[2]));
