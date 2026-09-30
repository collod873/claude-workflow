const STOPS = {
  unread: "The ticket or its PR cannot be read",
  modelRun: "A stage's model run exits non-zero, or gives no answer",
  drift: "The reviewer finds drift from `## Why`",
  unrecorded: "Close: the closing record is refused, or the ticket will not close",
  notResearch: "Research refused: the issue is not a research note",
  notSpec: "Refused: the issue is not labelled `spec`, or, for the done check, carries no sentence to try",
  unsliced: "Slice: the wave is still refused after two rounds back, so the spec is marked `needs-human`",
  unfiled: "Slice: the spec's rewrite or a ticket of its wave will not post",
} as const;

export type Stop = keyof typeof STOPS;

export function stoppedAt(stop: Stop, line: string): Stop {
  console.error(line);
  return stop;
}

export const exitFor = (stop: Stop | undefined): number => (stop === undefined ? 0 : 1);
