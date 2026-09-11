import { z } from "zod";
import type { GhExec } from "./gh";

export const RUNGS = ["implementer", "fresh-eyes", "mechanic", "decision"] as const;
export type Rung = (typeof RUNGS)[number];

export function rungFor(strikes: number): Rung {
  return RUNGS[Math.min(Math.max(strikes, 0), RUNGS.length - 1)];
}

export const STRIKE_MARKER_RE = /<!-- strike:v1 run=(\d+) conclusion=([a-z_]+) -->/;
const SIGNATURE_MARKER_RE = /<!-- strike-signature:(.*) -->/;
export const DECISION_MARKER = "<!-- strike-decision:v1 -->";
const SIGNATURE_CAP = 300;

const FAILED_LINE_RE = /(?:implement|mechanic|acceptance(?: [a-z-]+)?) failed: (.+)$/gm;

export const DEAD_CONCLUSIONS = ["failure", "cancelled", "timed_out"] as const;

export const LANE_RUN_TITLE_RE = /^(Implement|Mechanic|Acceptance) #(\d+)$/;

export type Next = Rung | "author";

export interface Strike {
  runId: number;
  conclusion: string;
  signature: string;
}

export function strikeSignature(text: string): string {
  return text.replace(/-->/g, "").replace(/\s+/g, " ").trim().slice(0, SIGNATURE_CAP);
}

export function signatureFromLog(raw: string, conclusion: string): string {
  const last = [...raw.matchAll(FAILED_LINE_RE)].at(-1);
  return last ? strikeSignature(last[1]) : `${conclusion} before answering`;
}

export function strikeBody(strike: Strike, runUrl: string, next: Next): string {
  return [
    `<!-- strike:v1 run=${strike.runId} conclusion=${strike.conclusion} -->`,
    `<!-- strike-signature:${strikeSignature(strike.signature)} -->`,
    `Strike: run ${runUrl} ended \`${strike.conclusion}\`.`,
    "",
    "```",
    strike.signature,
    "```",
    "",
    nextLine(next),
  ].join("\n");
}

function nextLine(next: Next): string {
  switch (next) {
    case "author":
      return "Next: the author starts again from the spec; the count climbs the same ladder.";
    case "implementer":
      return "Next: the implementer starts again from the brief.";
    case "fresh-eyes":
      return "Next: a second model with a clean context, handed this strike.";
    case "mechanic":
      return "Next: the mechanic, with the dead runs' logs and the whole tree in reach.";
    case "decision":
      return "Next: nothing runs until a human decides; the decision is posted below.";
  }
}

export function strikesIn(comments: string[]): Strike[] {
  const strikes: Strike[] = [];
  for (const body of comments) {
    if (body.includes(DECISION_MARKER)) {
      strikes.length = 0;
      continue;
    }
    const match = STRIKE_MARKER_RE.exec(body);
    if (!match) continue;
    const signature = SIGNATURE_MARKER_RE.exec(body)?.[1] ?? "";
    strikes.push({ runId: Number(match[1]), conclusion: match[2], signature });
  }
  return strikes;
}

export function recordedRunIds(comments: string[]): Set<number> {
  const ids = new Set<number>();
  for (const body of comments) {
    const match = STRIKE_MARKER_RE.exec(body);
    if (match) ids.add(Number(match[1]));
  }
  return ids;
}

export function decisionBody(ticket: number, strikes: Strike[], runUrl: (runId: number) => string): string {
  const lines = strikes.map(
    (strike, index) => `${index + 1}. ${runUrl(strike.runId)} ended \`${strike.conclusion}\`: \`${strike.signature}\``,
  );
  const identical = new Set(strikes.map((strike) => strike.signature)).size === 1;
  return [
    DECISION_MARKER,
    `Three runs of #${ticket} have died and nothing here will start a fourth.`,
    "",
    ...lines,
    "",
    identical
      ? "Every strike carries the same signature, so the cause is deterministic and outside what a model on this ticket can change."
      : "The signatures differ, so each attempt died somewhere new; the ticket itself may be asking for something the tree refuses.",
    "",
    "Options:",
    "",
    "- A. Fix what the strikes name (the ticket, the tree, or a credential), then remove `needs-human`: the next ending starts the ladder again from rung one.",
    "- B. Close the ticket as not planned, which retires it from the ready set.",
    "- C. Split the ticket, if the strikes show it claims more than one change; the new tickets start clean.",
    "",
    "Recommendation: A when the signature names a path or a command; B or C when it names the ticket's own shape.",
  ].join("\n");
}

const LaneRun = z.object({
  databaseId: z.number(),
  displayTitle: z.string(),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
  url: z.string(),
});
export type LaneRun = z.infer<typeof LaneRun>;
const LaneRuns = z.array(LaneRun);

export const RUN_PAGE_SIZE = 100;

export function fetchLaneRuns(gh: GhExec): LaneRun[] | null {
  try {
    const raw = gh([
      "run",
      "list",
      "--limit",
      String(RUN_PAGE_SIZE),
      "--json",
      "databaseId,displayTitle,status,conclusion,url",
    ]);
    const parsed = LaneRuns.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function ticketsInFlight(runs: LaneRun[]): Set<number> {
  const tickets = new Set<number>();
  for (const run of runs) {
    if (run.status === "completed") continue;
    const match = LANE_RUN_TITLE_RE.exec(run.displayTitle);
    if (match) tickets.add(Number(match[2]));
  }
  return tickets;
}

export function deadRunsOf(runs: LaneRun[], ticket: number): LaneRun[] {
  return runs.filter((run) => {
    if (run.status !== "completed") return false;
    if (!DEAD_CONCLUSIONS.some((conclusion) => conclusion === run.conclusion)) return false;
    const match = LANE_RUN_TITLE_RE.exec(run.displayTitle);
    return match !== null && Number(match[2]) === ticket;
  });
}

export function readFailedLog(gh: GhExec, runId: number): string {
  try {
    return gh(["run", "view", String(runId), "--log-failed"]);
  } catch {
    return "";
  }
}
