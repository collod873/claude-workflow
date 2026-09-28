export const STOPS = {
  shape: "Start refused: shape (a raw filing that skipped `file-issue`)",
  stale: "Start refused: a claimed file is deleted, or a check names a `--config` that does not exist",
  alreadyPasses: "Start: the ticket's checks already pass on main",
  unfreshTree: "Start: the tree is not clean, fresh main",
  unread: "The ticket or its PR cannot be read",
  modelRun: "A stage's model run exits non-zero, or gives no answer",
  drift: "The reviewer finds drift from `## Why`",
  unrecorded: "Close: the closing record is refused, or the ticket will not close",
  notResearch: "Research refused: the issue is not a research note",
  notSpec: "Cold read refused: the issue is not labelled `spec`",
} as const;

export type Stop = keyof typeof STOPS;

export interface Stopped {
  stop: Stop;
  refusals: string[];
}

export function stoppedAt(stop: Stop, line: string): Stop {
  console.error(line);
  return stop;
}

export const exitFor = (stop: Stop | undefined): number => (stop === undefined ? 0 : 1);
