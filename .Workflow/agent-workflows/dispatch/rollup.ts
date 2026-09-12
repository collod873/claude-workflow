import type { GhExec } from "../shared/gh";
import { isInFlight, QUEUED_LABEL, WAITING_LABEL } from "../shared/labels";

export const ROLLUP_MARKER = "<!-- rollup:v1 -->";

const ROLLUP_LINE_RE = /^<!-- rollup:v1 -->.*$/m;

export interface RollupCounts {
  building: number;
  queued: number;
  waiting: number;
  done: number;
}

export interface RollupChild {
  open: boolean;
  labels: readonly string[];
}

export function countRollup(children: RollupChild[]): RollupCounts {
  const counts: RollupCounts = { building: 0, queued: 0, waiting: 0, done: 0 };
  for (const child of children) {
    if (!child.open) counts.done += 1;
    else if (child.labels.some(isInFlight)) counts.building += 1;
    else if (child.labels.includes(QUEUED_LABEL)) counts.queued += 1;
    else if (child.labels.includes(WAITING_LABEL)) counts.waiting += 1;
  }
  return counts;
}

export function rollupLine(counts: RollupCounts): string {
  return `${ROLLUP_MARKER} ${counts.building} building · ${counts.queued} queued · ${counts.waiting} waiting · ${counts.done} done`;
}

export function readRollup(body: string): string | undefined {
  return ROLLUP_LINE_RE.exec(body)?.[0];
}

export function withRollup(body: string, line: string): string {
  if (readRollup(body) !== undefined) return body.replace(ROLLUP_LINE_RE, line);
  return `${line}\n\n${body}`;
}

export function writeRollup(gh: GhExec, prd: number, body: string, line: string): void {
  gh(["issue", "edit", String(prd), "--body", withRollup(body, line)]);
}
