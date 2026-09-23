import { spawnSync } from "node:child_process";
import { text as read } from "node:stream/consumers";
import { stripVTControlCharacters } from "node:util";
import { checks, quoted } from "./ticket-shape.ts";

export type Shell = (command: string, cwd: string) => { status: number | null; stdout: string; stderr: string };

interface Outcome {
  passed: boolean;
  why: string;
  output: string;
}

export const RAN_NO_TESTS = "ran no tests";

const RUNS_VITEST = /(?<![A-Za-z])vitest(?![A-Za-z])/;
const SUMMARY = /^[ \t]*Tests[ \t]+(.+)$/m;
const COUNTED = /(\d+)[ \t]+(?:passed|failed)/g;

const bash: Shell = (command, cwd) => spawnSync("bash", ["-c", command], { cwd, encoding: "utf8" });

function testsRan(output: string): number {
  const summary = SUMMARY.exec(stripVTControlCharacters(output))?.[1] ?? "";
  return [...summary.matchAll(COUNTED)].reduce((total, [, counted]) => total + Number(counted), 0);
}

export function runCheck(command: string, cwd: string, run: Shell = bash): Outcome {
  const { status, stdout, stderr } = run(command, cwd);
  const output = `${stdout}${stderr}`;
  if (RUNS_VITEST.test(command) && testsRan(output) === 0) return { passed: false, why: RAN_NO_TESTS, output };
  return status === 0 ? { passed: true, why: "", output } : { passed: false, why: `exited ${status}`, output };
}

export function passingCriteria(body: string, cwd: string, run: Shell = bash): string[] {
  return checks(body)
    .filter(({ command }) => runCheck(command, cwd, run).passed)
    .map(({ at, command }) => `${at} already passes, so it measures nothing: \`${quoted(command)}\``);
}

if (import.meta.main) {
  const refusals = passingCriteria(await read(process.stdin), process.cwd());
  for (const refusal of refusals) console.error(refusal);
  process.exit(refusals.length > 0 ? 1 : 0);
}
