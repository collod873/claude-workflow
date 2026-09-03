import { createFakeGh, type FakeDispatch } from "../shared/gh.fake";
import { runJobsPathMatcher, workflowRunsPathMatcher } from "../shared/gh-paths";
import { createFakeGit, type FakeGit } from "../shared/git.fake";
import {
  GATE_JOB,
  IMMUTABILITY_JOB,
  type CloseTicketResult,
  type GauntletResult,
  type IntegrateDeps,
} from "./integrate";

/**
 * The world lane 08's tests run in: one pull request, one trunk tip, and lane 06's run history as
 * the Actions API reports it. `integrateHarness` builds the `IntegrateDeps` for one scripted case
 * and hands back every recording the assertions read.
 *
 * The `gh` here is a local handler for this lane's own calls — `pr view`, the run history and job
 * reads the verdict comes off, `pr merge`, the comments a refusal leaves — composed in front of
 * `createFakeGh`, which records the `graph-changed` doorbell as a `FakeDispatch` and throws on
 * anything neither side models. The Actions endpoints are recognised through `gh-paths.ts`'s own
 * matchers, so this cannot answer a path different from the one `integrate.ts` sends.
 *
 * @fixture Reached only from this lane's tests, by design.
 */

export const PR = "https://github.com/owner/repo/pull/42";
export const BRANCH = "implement/issue-42";
export const TICKET = 190;
export const TRUNK_SHA = "1111111111111111111111111111111111111111";
export const HEAD_SHA = "2222222222222222222222222222222222222222";
export const RANGE = `${TRUNK_SHA}..${HEAD_SHA}`;

export const PR_BODY = `Rebuilt the thing.\n\nCloses #${TICKET}`;

export interface VerifyJobFixture {
  name: string;
  status?: string;
  conclusion?: string | null;
}

export interface VerifyRunFixture {
  id?: number;
  headSha?: string;
  event?: string;
  status?: string;
  judging?: string;
  jobs?: VerifyJobFixture[];
}

export const BOTH_JOBS_GREEN: VerifyJobFixture[] = [
  { name: IMMUTABILITY_JOB, conclusion: "success" },
  { name: GATE_JOB, conclusion: "success" },
];

export const GATE_JOB_RED: VerifyJobFixture[] = [
  { name: IMMUTABILITY_JOB, conclusion: "success" },
  { name: GATE_JOB, conclusion: "failure" },
];

export const GATE_JOB_RUNNING: VerifyJobFixture[] = [
  { name: IMMUTABILITY_JOB, conclusion: "success" },
  { name: GATE_JOB, status: "in_progress", conclusion: null },
];

export const LANE_06_ALL_GREEN: VerifyRunFixture[] = [{ id: 900, jobs: BOTH_JOBS_GREEN }];

export const CLOSED: CloseTicketResult = { exitCode: 0, output: "## Closing record\n" };
export const REFUSED: CloseTicketResult = {
  exitCode: 1,
  output: "error: 4 acceptance criteria and every criterion unverified",
};

export interface HarnessOptions {
  gauntlet?: GauntletResult;
  closeTicket?: CloseTicketResult;
  body?: string;
  commentThrows?: boolean;
  prCommentThrows?: boolean;
  verifyRuns?: VerifyRunFixture[] | (() => VerifyRunFixture[]);
  rebaseLeavesUnmerged?: string[];
}

export interface IntegrateHarness {
  fakeGit: FakeGit;
  calls: string[][];
  closeCalls: Array<[number, string]>;
  sleeps: number[];
  dispatches: FakeDispatch[];
  gauntletRuns: () => number;
  deps: IntegrateDeps;
}

interface ScriptedJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

function scriptRuns(fixtures: VerifyRunFixture[]) {
  return fixtures.map((run, index) => {
    const id = run.id ?? 900 + index;
    const jobs: ScriptedJob[] = (run.jobs ?? []).map((job, jobIndex) => ({
      id: id * 10 + jobIndex,
      name: job.name,
      status: job.status ?? "completed",
      conclusion: job.conclusion ?? null,
    }));
    return {
      id,
      head_sha: run.headSha ?? TRUNK_SHA,
      event: run.event ?? "repository_dispatch",
      status: run.status ?? (jobs.every((job) => job.status === "completed") ? "completed" : "in_progress"),
      judging: run.judging ?? PR,
      jobs,
    };
  });
}

export function integrateHarness({
  gauntlet = { exitCode: 0 },
  closeTicket,
  body = PR_BODY,
  commentThrows = false,
  prCommentThrows = false,
  verifyRuns = LANE_06_ALL_GREEN,
  rebaseLeavesUnmerged,
}: HarnessOptions = {}): IntegrateHarness {
  const fakeGit = createFakeGit((args) => {
    if (args[0] === "rev-parse") return `${args[1] === "HEAD" ? HEAD_SHA : TRUNK_SHA}\n`;
    if (args[0] === "rebase" && args[1] === "origin/main" && rebaseLeavesUnmerged !== undefined) {
      throw new Error("git: could not apply 2a8fd1e… CONFLICT (content)");
    }
    if (args[0] === "diff") return `${(rebaseLeavesUnmerged ?? []).join("\n")}\n`;
    return "";
  });
  const calls: string[][] = [];
  const closeCalls: Array<[number, string]> = [];
  const sleeps: number[] = [];
  let gauntletRuns = 0;

  const currentRuns = () => scriptRuns(typeof verifyRuns === "function" ? verifyRuns() : verifyRuns);

  const answer = (args: string[]): string | undefined => {
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ headRefName: BRANCH, body });
    if (args[0] === "run" && args[1] === "view" && args[2] === "--job" && args[4] === "--log") {
      const jobId = Number(args[3]);
      const run = currentRuns().find((each) => each.jobs.some((job) => job.id === jobId));
      const job = run?.jobs.find((each) => each.id === jobId);
      if (!run || !job) return "";
      if (job.status !== "completed") {
        throw new Error(`gh: job ${jobId} is still in progress; logs will be available when it is complete`);
      }
      return `judging ${run.judging} on implement/issue-190\n`;
    }
    if (args[0] === "run" && args[1] === "view" && args[3] === "--log") {
      throw new Error(`gh: run ${args[2]} is still in progress; logs will be available when it is complete`);
    }
    if (args[0] === "pr" && (args[1] === "merge" || args[1] === "edit")) return "";
    if (args[0] === "pr" && args[1] === "comment") {
      if (prCommentThrows) throw new Error("gh: could not comment on the pull request");
      return "";
    }
    if (args[0] === "api" && workflowRunsPathMatcher.test((args[1] ?? "").split("?")[0])) {
      return JSON.stringify(
        currentRuns().map(({ id, head_sha, event, status }) => ({ id, head_sha, event, status })),
      );
    }
    const jobsMatch = (args[1] ?? "").match(runJobsPathMatcher);
    if (args[0] === "api" && jobsMatch) {
      return JSON.stringify(currentRuns().find((run) => run.id === Number(jobsMatch[1]))?.jobs ?? []);
    }
    if (args[0] === "issue" && args[1] === "comment") {
      if (commentThrows) throw new Error("gh: could not comment");
      return "";
    }
    if (args[0] === "label" && args[1] === "create") return "";
    if (args[0] === "issue" && args[1] === "edit") return "";
    return undefined;
  };

  const doorbell = createFakeGh();
  const gh = (args: string[]): string => {
    calls.push(args);
    return answer(args) ?? doorbell.gh(args);
  };

  return {
    fakeGit,
    calls,
    closeCalls,
    sleeps,
    dispatches: doorbell.dispatches,
    gauntletRuns: () => gauntletRuns,
    deps: {
      git: fakeGit.git,
      gh,
      pr: PR,
      headSha: TRUNK_SHA,
      verifyWorkflow: "verify-caller.yml",
      runGauntlet: () => {
        gauntletRuns += 1;
        return gauntlet;
      },
      sleep: () => {
        sleeps.push(1);
      },
      closeTicket: (ticket: number, range: string): CloseTicketResult => {
        closeCalls.push([ticket, range]);
        if (closeTicket === undefined) throw new Error("closeTicket called when the test expected none");
        return closeTicket;
      },
    },
  };
}

export function mergeCalls(calls: string[][]): string[][] {
  return calls.filter((call) => call[0] === "pr" && call[1] === "merge");
}

export function prComments(calls: string[][]): string[][] {
  return calls.filter((call) => call[0] === "pr" && call[1] === "comment");
}
