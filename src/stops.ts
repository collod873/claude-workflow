const STOPS = {
  unread: "The ticket or its PR cannot be read",
  modelRun: "A stage's model run exits non-zero, or gives no answer",
  drift: "The reviewer finds drift from `## Why`",
  unrecorded: "Close: the closing record is refused, or the ticket will not close",
  notResearch: "Research refused: the issue is not a research note",
  notSpec: "Cold read refused: the issue is not labelled `spec`",
} as const;

export type Stop = keyof typeof STOPS;

export function stoppedAt(stop: Stop, line: string): Stop {
  console.error(line);
  return stop;
}

export const exitFor = (stop: Stop | undefined): number => (stop === undefined ? 0 : 1);
