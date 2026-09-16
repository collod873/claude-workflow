import { expect, test } from "vitest";
import type { GhExec } from "./gh";
import { runJobsPath, workflowRunsPath } from "./gh-paths";
import { adr0106Payloads } from "./tracker-payloads";
import { trackerGh } from "./tracker-gh";
import { trackerMemory } from "./tracker-memory";

const RUN = {
  id: 501,
  conclusion: "failure",
  htmlUrl: "https://github.com/owner/repo/actions/runs/501",
  headBranch: "main",
  createdAt: "2026-08-26T12:00:00Z",
  event: "push",
};

const JOB = { steps: [{ name: "Gauntlet", conclusion: "failure" }] };

function ghStub(): GhExec {
  return (args: string[]): string => {
    if (args[0] === "api" && args[1] === workflowRunsPath("verify.yml", 5)) {
      return JSON.stringify([
        {
          id: RUN.id,
          conclusion: RUN.conclusion,
          html_url: RUN.htmlUrl,
          head_branch: RUN.headBranch,
          created_at: RUN.createdAt,
          event: RUN.event,
        },
      ]);
    }
    if (args[0] === "api" && args[1] === runJobsPath(RUN.id)) {
      return JSON.stringify({ jobs: [JOB] });
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
}

test("#607.2: the memory adapter answers workflowRuns and jobs from its seeded Map", () => {
  const tracker = trackerMemory({ runs: [RUN], jobs: { [RUN.id]: [JOB] } });

  expect(tracker.workflowRuns("verify.yml", 5)).toEqual([RUN]);
  expect(tracker.jobs(RUN.id)).toEqual([JOB]);
});

test("#607.2: the gh adapter answers workflowRuns and jobs the same as the memory adapter, from a stub GhExec", () => {
  const tracker = trackerGh(ghStub());

  expect(tracker.workflowRuns("verify.yml", 5)).toEqual([RUN]);
  expect(tracker.jobs(RUN.id)).toEqual([JOB]);
});

test.fails("#608.2: the gh-adapter case replays its run and job payloads from shared/tracker-payloads.ts instead of an inline literal", () => {
  const payloads = adr0106Payloads();
  const ghFromPayloads: GhExec = (args: string[]): string => {
    if (args[0] === "api" && args[1] === workflowRunsPath("verify.yml", 5)) {
      return JSON.stringify([payloads.workflowRun]);
    }
    if (args[0] === "api" && args[1] === runJobsPath(payloads.workflowRun.id)) {
      return JSON.stringify({ jobs: [payloads.job] });
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };

  const tracker = trackerGh(ghFromPayloads);

  expect(tracker.workflowRuns("verify.yml", 5)).toEqual([RUN]);
  expect(tracker.jobs(RUN.id)).toEqual([JOB]);
});
