import { z } from "zod";
import type { GhExec } from "./gh";
import { blockedByPath, runJobsPath, workflowRunsPath } from "./gh-paths";
import type { Tracker, TrackerBlocker, WorkflowRun } from "./tracker";

const ApiRun = z.object({
  id: z.number(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  head_branch: z.string().nullable(),
  created_at: z.string(),
  event: z.string(),
});

const JobsResponse = z.object({
  jobs: z.array(
    z.object({
      steps: z.array(
        z.object({
          name: z.string(),
          conclusion: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const ApiBlocker = z.object({
  number: z.number(),
  state: z.string(),
  state_reason: z.string().nullable().optional(),
});

function toWorkflowRun(run: z.infer<typeof ApiRun>): WorkflowRun {
  return {
    id: run.id,
    conclusion: run.conclusion ?? "",
    htmlUrl: run.html_url,
    headBranch: run.head_branch ?? "",
    createdAt: run.created_at,
    event: run.event,
  };
}

function toBlocker(blocker: z.infer<typeof ApiBlocker>): TrackerBlocker {
  return { number: blocker.number, state: blocker.state, stateReason: blocker.state_reason ?? null };
}

export function trackerGh(gh: GhExec): Tracker {
  return {
    workflowRuns(workflow, perPage) {
      const projection = "[.workflow_runs[] | {id, conclusion, html_url, head_branch, created_at, event}]";
      const raw = gh(["api", workflowRunsPath(workflow, perPage), "--jq", projection]);
      return ApiRun.array()
        .parse(JSON.parse(raw))
        .map(toWorkflowRun);
    },
    jobs(runId) {
      const raw = gh(["api", runJobsPath(runId)]);
      return JobsResponse.parse(JSON.parse(raw)).jobs;
    },
    blockedBy(number) {
      const raw = gh(["api", blockedByPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
      return ApiBlocker.array()
        .parse(JSON.parse(raw))
        .map(toBlocker);
    },
  };
}
