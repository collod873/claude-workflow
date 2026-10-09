const STOPS = {
  unread: "The ticket or its PR cannot be read",
  unwritten: "A stage's mark is refused: the mark command ends non-zero",
  modelRun: "A stage's model run exits non-zero, or gives no answer",
  unrecorded: "Close: the closing record is refused, or the ticket will not close",
  unmoved: "Close: a green PR behind main could not be brought up to date, and no other PR moved",
} as const;

export type Stop = keyof typeof STOPS;

function said<Stopped extends string>(stop: Stopped, line: string): Stopped {
  console.error(line);
  return stop;
}

export const stoppedAt = (stop: Stop, line: string): Stop => said(stop, line);

export const stopsOf =
  <const Own extends Record<string, string>>(own: Own) =>
  (stop: Stop | Extract<keyof Own, string>, line: string): Stop | Extract<keyof Own, string> =>
    said(stop, line);

export const exitFor = (stop: string | undefined): number => (stop === undefined ? 0 : 1);
