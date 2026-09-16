import type { GhExec } from "../shared/gh";
import type { WorkflowRun } from "../shared/tracker";
import { trackerMemory } from "../shared/tracker-memory";

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

function toWorkflowRun(run: SlicingRun, index: number): WorkflowRun {
  return {
    id: index + 1,
    conclusion: run.conclusion === undefined ? "success" : (run.conclusion ?? ""),
    htmlUrl: `https://github.com/owner/repo/actions/runs/${index + 1}`,
    headBranch: "main",
    createdAt: run.created_at ?? "2026-08-21T00:00:00Z",
    event: "push",
  };
}

function toApiRun(run: WorkflowRun): object {
  return {
    id: run.id,
    conclusion: run.conclusion,
    html_url: run.htmlUrl,
    head_branch: run.headBranch,
    created_at: run.createdAt,
    event: run.event,
  };
}

function answerStanding(args: string[], issues: readonly StandingIssueFixture[]): string {
  if (args[0] === "issue" && args[1] === "list") return JSON.stringify(issues);
  if (args[0] === "issue" && args[1] === "create") return "https://github.com/owner/repo/issues/42\n";
  throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
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
  const runs = options.runs ?? [];
  const tracker = trackerMemory({ runs: runs.map(toWorkflowRun) });

  const gh: GhExec = (args) => {
    calls.push(args);

    if (args[0] === "issue" && args[1] === "view") {
      return JSON.stringify({ ...prdData, labels: prdData.labels.map((name) => ({ name })) });
    }
    if (args[0] === "api" && (args[1] ?? "").includes("/sub_issues")) {
      return `${options.subIssueCount ?? 0}\n`;
    }
    if (args[0] === "api" && (args[1] ?? "").includes("/runs")) {
      return JSON.stringify(tracker.workflowRuns("", runs.length).map(toApiRun));
    }
    if (args[0] === "issue" && args[1] === "comment") return "";

    return answerStanding(args, standing);
  };

  return { gh, calls };
}

/** @fixture one slicing run recorded after the PRD was opened, with no standing signal yet */
export function historyWithRunSincePrd(run: { status: string; conclusion: string | null }): ReturnType<typeof slicingHistoryWith> {
  return slicingHistoryWith({ subIssueCount: 0, runs: [run] });
}
