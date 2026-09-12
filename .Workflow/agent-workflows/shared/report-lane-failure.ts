import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "./gh";
import { handoffPath } from "./handoff-path";

export const FINISHED_CLEAN = "success";

export const WAS_CANCELLED = "cancelled";

export const REPORTED_LANES = ["shape", "shape-accept", "spec", "to-tickets"] as const;

export type ReportedLane = (typeof REPORTED_LANES)[number];

export function isReportedLane(value: string): value is ReportedLane {
  return (REPORTED_LANES as readonly string[]).includes(value);
}

interface LaneWording {
  opening: (verb: string) => string;
  carriesReason: boolean;
  checkpoints?: (issue: number) => string;
  recovery?: string;
  label?: string;
}

const WORDING: Record<ReportedLane, LaneWording> = {
  shape: {
    opening: () => "Shape run failed.",
    carriesReason: true,
    checkpoints: (issue) => `checkpoints-shape-${issue}`,
  },
  "shape-accept": {
    opening: (verb) => `The \`${verb}\` accept did not finish.`,
    carriesReason: false,
    recovery:
      "Nothing here is automatic to recover: check whether `docs/adr/` and `CONTEXT.md` took the writes before re-applying the label.",
  },
  spec: {
    opening: () => "The spec lane did not finish.",
    carriesReason: false,
    recovery:
      "Nothing here is automatic to recover: the run below says where it stopped, and re-applying `to-spec` starts it again.",
  },
  "to-tickets": {
    opening: () => "to-tickets run failed.",
    carriesReason: true,
    checkpoints: (issue) => `checkpoints-to-tickets-${issue}`,
    label: "slice-failed",
  },
};

export interface LaneEnding {
  lane: ReportedLane;
  status: string;
  issue: number;
  runUrl: string;
  reason: string | undefined;
  verb: string;
  refused: boolean;
}

export function laneFailureComment(ending: LaneEnding): string | undefined {
  if (ending.status === FINISHED_CLEAN || ending.refused) return undefined;

  const wording = WORDING[ending.lane];
  const parts = [wording.opening(ending.verb)];

  if (ending.status === WAS_CANCELLED) {
    parts.push("The runner **cancelled** this run, so the lane never reached the code that reports why it stopped.");
  }
  if (wording.carriesReason) parts.push(`**Reason:** ${ending.reason ?? "unknown stage"}`);
  if (wording.recovery) parts.push(wording.recovery);
  parts.push(`**Workflow run:** ${ending.runUrl}`);
  if (wording.checkpoints) parts.push(`**Checkpoints:** the \`${wording.checkpoints(ending.issue)}\` artifact on that run.`);

  return `${parts.join("\n\n")}\n`;
}

export function labelFor(lane: ReportedLane): string | undefined {
  return WORDING[lane].label;
}

export function reportLaneEnding(gh: GhExec, ending: LaneEnding): boolean {
  const body = laneFailureComment(ending);
  if (body === undefined) return false;

  gh(["issue", "comment", String(ending.issue), "--body", body]);
  const label = labelFor(ending.lane);
  if (label !== undefined) gh(["issue", "edit", String(ending.issue), "--add-label", label]);
  return true;
}

function readReason(): string | undefined {
  const path = handoffPath();
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8").trim();
  return text === "" ? undefined : text;
}

function main(): void {
  const lane = process.env.REPORT_LANE ?? "";
  if (!isReportedLane(lane)) {
    console.error(`report-lane-failure: ${JSON.stringify(lane)} is not a lane that reports its own endings`);
    process.exitCode = 1;
    return;
  }

  const issue = Number(process.env.REPORT_ISSUE);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    console.log(`${lane}: no issue number to report against; nothing said`);
    return;
  }

  const ending: LaneEnding = {
    lane,
    status: process.env.JOB_STATUS ?? "",
    issue,
    runUrl: process.env.RUN_URL ?? "",
    reason: readReason(),
    verb: process.env.VERB ?? "",
    refused: process.env.REPORT_REFUSED === "true",
  };

  if (reportLaneEnding(execGh, ending)) console.log(`${lane}: reported a ${ending.status} ending on #${issue}`);
  else console.log(`${lane}: ended ${ending.status || "cleanly"}; nothing to report`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
