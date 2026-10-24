interface Stops {
  unread: "The ticket or its PR cannot be read";
  unwritten: "A stage's mark is refused: the mark command ends non-zero";
  modelRun: "A stage's model run exits non-zero, or gives no answer";
  unrecorded: "Close: the closing record is refused, or the ticket will not close";
}

export type Stop = keyof Stops;

function said<Stopped extends string>(stop: Stopped, line: string): Stopped {
  console.error(line);
  return stop;
}

export const stoppedAt = (stop: Stop, line: string): Stop => said(stop, line);

export const stopsOf =
  <const Own extends Record<string, string>>(_own: Own) =>
  (stop: Stop | Extract<keyof Own, string>, line: string): Stop | Extract<keyof Own, string> =>
    said(stop, line);

export const exitFor = (stop: string | undefined): number => (stop === undefined ? 0 : 1);
