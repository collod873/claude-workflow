import type { GhExec } from "../shared/gh";
import { answerTrackerOrThrow } from "./signal-tracker.fixture";

interface SlicingRun {
  status?: string;
  conclusion?: string | null;
  created_at?: string;
}

interface StandingIssueFixture {
  number: number;
  state: string;
  body: string;
  comments?: Array<{ body: string }>;
}

/** @fixture the slicing history both lost-dispatch suites drive the counter through */
export function slicingHistoryWith(options: {
  prd?: { title?: string; createdAt?: string; labels?: string[] };
  subIssueCount?: number;
  runs?: SlicingRun[];
  standing?: StandingIssueFixture[];
}): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const prdData = { title: "A spec", createdAt: "2026-08-20T00:00:00Z", labels: ["sliceable"], ...options.prd };
  const standing = (options.standing ?? []).map((issue) => ({ ...issue, comments: issue.comments ?? [] }));

  const gh: GhExec = (args) => {
    calls.push(args);

    if (args[0] === "issue" && args[1] === "view") {
      return JSON.stringify({ ...prdData, labels: prdData.labels.map((name) => ({ name })) });
    }
    if (args[0] === "api" && (args[1] ?? "").includes("/sub_issues")) {
      return `${options.subIssueCount ?? 0}\n`;
    }
    if (args[0] === "api" && (args[1] ?? "").includes("/runs")) {
      return JSON.stringify((options.runs ?? []).map((run) => ({ status: run.status ?? "completed", conclusion: run.conclusion === undefined ? "success" : run.conclusion, created_at: run.created_at ?? "2026-08-21T00:00:00Z" })));
    }
    if (args[0] === "issue" && args[1] === "comment") return "";

    return answerTrackerOrThrow(args, standing);
  };

  return { gh, calls };
}

/** @fixture one slicing run recorded after the PRD was opened, with no standing signal yet */
export function historyWithRunSincePrd(run: { status: string; conclusion: string | null }): ReturnType<typeof slicingHistoryWith> {
  return slicingHistoryWith({ subIssueCount: 0, runs: [run] });
}
