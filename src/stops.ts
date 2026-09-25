import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const STOPPED_AT = /^\d+ refusals, stopped at: (.+)$/;

export const STOPS = {
  shape: "Start refused: shape (a raw filing that skipped `file-issue`)",
  stale: "Start refused: a claimed file is deleted, or a check names a `--config` that does not exist",
  alreadyPasses: "Start: the ticket's checks already pass on main",
  unfreshTree: "Start: the tree is not clean, fresh main",
  unread: "The ticket or its PR cannot be read",
  overCap: "A brief is over its 200 KB cap",
  dirtyTree: "A stage finds uncommitted work in the tree",
  noTest: "The test author writes no test, or cannot write a failing test for a criterion",
  modelRun: "A stage writes outside the repo, or its model run exits non-zero",
  uncommitted: "A stage's work will not commit",
  buildRed: "Build red after 3 rounds handed back",
  drift: "The reviewer finds drift from `## Why`",
  fixerEnds: "The fixer ends red, or rules the ticket should not exist as written",
  unrecorded: "Close: the closing record is refused, or the ticket will not close",
} as const;

export type Stop = keyof typeof STOPS;

type Clearer = "the fixer" | "nobody" | "the run that started it";

const STOP_CLEARERS: Record<Stop, Clearer> = {
  shape: "the fixer",
  stale: "the fixer",
  alreadyPasses: "nobody",
  unfreshTree: "the run that started it",
  unread: "the fixer",
  overCap: "the fixer",
  dirtyTree: "the run that started it",
  noTest: "the fixer",
  modelRun: "the fixer",
  uncommitted: "the fixer",
  buildRed: "the fixer",
  drift: "the fixer",
  fixerEnds: "nobody",
  unrecorded: "the fixer",
};

export const STOPS_NAMED_OUTSIDE_STAGES: Record<string, Clearer> = {
  "Save: the push is refused": "the fixer",
  "Save: the PR is not open with auto-merge on": "the fixer",
  "Green on the ticket's checks, red on the PR's required check": "the fixer",
  "Red on main after merge": "the fixer",
  "A job cannot fetch the owner's hooks after 3 tries": "nobody",
};

export function clearerOf(row: string): Clearer | undefined {
  const stop = (Object.keys(STOPS) as Stop[]).find((key) => STOPS[key] === row);
  return stop === undefined ? STOPS_NAMED_OUTSIDE_STAGES[row] : STOP_CLEARERS[stop];
}

export interface Stopped {
  stop: Stop;
  refusals: string[];
}

export function stoppedAt(stop: Stop, line: string): Stop {
  console.error(line);
  return stop;
}

export function rowStopped(ticket: string, logs: string): string | undefined {
  if (!existsSync(logs)) return undefined;
  return readdirSync(logs)
    .filter((name) => name.endsWith(`-${ticket}.log`))
    .map((name) => join(logs, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .flatMap((log) => STOPPED_AT.exec(readFileSync(log, "utf8").split("\n")[0])?.slice(1) ?? [])[0];
}

export const exitFor = (stop: Stop | undefined): number => (stop === undefined ? 0 : 1);
