import { expect, test } from "vitest";
import type { GhExec } from "./gh";
import { jobLogsPath, runJobsPath, workflowRunsPath } from "./gh-paths";
import { adr0106Payloads } from "./tracker-payloads";
import { trackerGh } from "./tracker-gh";
import { trackerMemory } from "./tracker-memory";

const RUN = {
  id: 501,
  status: "completed",
  conclusion: "failure",
  htmlUrl: "https://github.com/owner/repo/actions/runs/501",
  headBranch: "main",
  headSha: "2222222222222222222222222222222222222222",
  createdAt: "2026-08-26T12:00:00Z",
  event: "push",
};

const JOB = {
  id: 5010,
  name: "Gauntlet",
  status: "completed",
  conclusion: "failure",
  steps: [{ name: "Gauntlet", conclusion: "failure" }],
};

function ghStub(): GhExec {
  return (args: string[]): string => {
    if (args[0] === "api" && args[1] === workflowRunsPath("verify.yml", 5)) {
      return JSON.stringify([
        {
          id: RUN.id,
          status: RUN.status,
          conclusion: RUN.conclusion,
          html_url: RUN.htmlUrl,
          head_branch: RUN.headBranch,
          head_sha: RUN.headSha,
          created_at: RUN.createdAt,
          event: RUN.event,
        },
      ]);
    }
    if (args[0] === "api" && args[1] === runJobsPath(RUN.id)) {
      return JSON.stringify({ jobs: [JOB] });
    }
    if (args[0] === "api" && args[1] === jobLogsPath(JOB.id)) {
      return "judging https://github.com/owner/repo/pull/1 on implement/issue-1\n";
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

test("#608.2: the gh-adapter case replays its run and job payloads from shared/tracker-payloads.ts instead of an inline literal", () => {
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
test("#623: the memory adapter answers jobLog from its seeded Map, and the gh adapter reads the same job's log", () => {
  const memory = trackerMemory({ jobLogs: { [JOB.id]: "judging https://github.com/owner/repo/pull/1 on implement/issue-1\n" } });
  const gh = trackerGh(ghStub());

  expect(memory.jobLog(JOB.id)).toBe(gh.jobLog(JOB.id));
});

test("#629: deleteBranch removes the branch from the memory adapter, and the gh adapter sends the same branch's ref DELETE", () => {
  const memory = trackerMemory({ branches: ["accept/issue-1", "accept/issue-2"] });
  const calls: string[][] = [];
  const gh = trackerGh((args) => {
    calls.push(args);
    return "";
  });

  memory.deleteBranch("accept/issue-1");
  gh.deleteBranch("accept/issue-1");

  expect(memory.branchesUnder("accept/")).toEqual(["accept/issue-2"]);
  expect(calls).toEqual([["api", "--method", "DELETE", "repos/{owner}/{repo}/git/refs/heads/accept/issue-1"]]);
});
