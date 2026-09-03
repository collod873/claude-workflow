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
/**
 * Trunk's tip. It is `origin/main` in the rebased checkout *and* the `github.sha` both lane 06's
 * run and lane 08's run carry — a `repository_dispatch` run executes trunk's copy of the workflow
 * at trunk's tip (ADR-0054), which is the whole reason lane 08 can find lane 06 at all.
 */
export const TRUNK_SHA = "1111111111111111111111111111111111111111";
export const HEAD_SHA = "2222222222222222222222222222222222222222";
export const RANGE = `${TRUNK_SHA}..${HEAD_SHA}`;

/** What lane 05's `openPrAndDispatch` writes: the implementer's summary, then the closing reference. */
export const PR_BODY = `Rebuilt the thing.\n\nCloses #${TICKET}`;

/** One job on a scripted Verify run, as the Actions jobs API reports it. */
export interface VerifyJobFixture {
  name: string;
  /** `queued`, `in_progress` or `completed`; defaults to `completed`. */
  status?: string;
  /** `success`, `failure`, `skipped`, `cancelled`, … or `null` while it is still running. */
  conclusion?: string | null;
}

/** One scripted Verify run, as the Actions runs API reports it. */
export interface VerifyRunFixture {
  id?: number;
  /** Defaults to `TRUNK_SHA` — the commit lane 08's own run carries. */
  headSha?: string;
  /** Defaults to `repository_dispatch`; `push` is the trunk run at the very same commit. */
  event?: string;
  /**
   * The run's own `status`. Defaults to what its jobs say — `completed` only when every one of
   * them has finished — so a fixture that scripts a job mid-flight scripts a live run without
   * having to say so twice.
   */
  status?: string;
  /** The pull request this run's log says it was judging (ADR-0104). Defaults to the one under test. */
  judging?: string;
  jobs?: VerifyJobFixture[];
}

/** Lane 06's two jobs, both cleared — the only reading that lets a merge through. */
export const BOTH_JOBS_GREEN: VerifyJobFixture[] = [
  { name: IMMUTABILITY_JOB, conclusion: "success" },
  { name: GATE_JOB, conclusion: "success" },
];

/** The immutable set cleared and the gate red — the verdict a fixer reacts to. */
export const GATE_JOB_RED: VerifyJobFixture[] = [
  { name: IMMUTABILITY_JOB, conclusion: "success" },
  { name: GATE_JOB, conclusion: "failure" },
];

/** Lane 06 mid-verdict: the immutable set cleared, the gate job still running. */
export const GATE_JOB_RUNNING: VerifyJobFixture[] = [
  { name: IMMUTABILITY_JOB, conclusion: "success" },
  { name: GATE_JOB, status: "in_progress", conclusion: null },
];

/** Lane 06 having judged this head commit and cleared both jobs. */
export const LANE_06_ALL_GREEN: VerifyRunFixture[] = [{ id: 900, jobs: BOTH_JOBS_GREEN }];

export const CLOSED: CloseTicketResult = { exitCode: 0, output: "## Closing record\n" };
export const REFUSED: CloseTicketResult = {
  exitCode: 1,
  output: "error: 4 acceptance criteria and every criterion unverified",
};

export interface HarnessOptions {
  gauntlet?: GauntletResult;
  /** What the injected `closeTicket` seam answers; `undefined` means the test asserts it is never called. */
  closeTicket?: CloseTicketResult;
  /** The pull request body `gh pr view` answers with — overridden by the "names no ticket" case. */
  body?: string;
  /** Makes the ticket comment throw, standing in for a tracker write that fails after the merge. */
  commentThrows?: boolean;
  /** Makes the pull-request comment throw, standing in for the gate refusal failing to post. */
  prCommentThrows?: boolean;
  /**
   * What the Verify workflow's run history answers with. Defaults to lane 06 having cleared both
   * jobs. A function is re-evaluated on every lookup, which is how a test scripts a job that is
   * still running on one read and finished on the next — the case ADR-0104's wait exists for.
   */
  verifyRuns?: VerifyRunFixture[] | (() => VerifyRunFixture[]);
  /**
   * Makes `git rebase origin/main` fail, leaving these paths unmerged. `[]` is the other failure
   * this scripts: a rebase that died for some reason that is not a conflict at all, which leaves
   * nothing in `--diff-filter=U` and is not this lane's to swallow.
   */
  rebaseLeavesUnmerged?: string[];
}

export interface IntegrateHarness {
  fakeGit: FakeGit;
  /** Every `gh` argv, in call order. */
  calls: string[][];
  closeCalls: Array<[number, string]>;
  /** One entry per `sleep`, counted rather than waited on. */
  sleeps: number[];
  /** Every `repository_dispatch` sent — the doorbell, when it rang. */
  dispatches: FakeDispatch[];
  /** How many times this lane spent a push-venue run — the cost a refusal upstream of it saves. */
  gauntletRuns: () => number;
  deps: IntegrateDeps;
}

interface ScriptedJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

/** Resolves the run fixtures into what the two Actions endpoints and the job log answer. */
function scriptRuns(fixtures: VerifyRunFixture[]) {
  return fixtures.map((run, index) => {
    const id = run.id ?? 900 + index;
    const jobs: ScriptedJob[] = (run.jobs ?? []).map((job, jobIndex) => ({
      // A job id the Actions API would answer with, derived from its run so the fake can route a
      // `--job <id> --log` read back to the run that owns it.
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
    // git reports a stopped rebase the same way it reports any other failed command: a nonzero
    // exit, which `execGit` turns into a throw. What separates a conflict from every other reason
    // a rebase can die is the unmerged-paths read below, never the exception.
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

  // Resolved per lookup, not once: a `verifyRuns` function is how a test scripts lane 06 finishing
  // between two of this lane's reads.
  const currentRuns = () => scriptRuns(typeof verifyRuns === "function" ? verifyRuns() : verifyRuns);

  const answer = (args: string[]): string | undefined => {
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ headRefName: BRANCH, body });
    // `gh run view --job <id> --log`, the job-addressed read `integrate.ts` makes. It throws for a
    // job that has not finished, exactly as `gh` does — the constraint that makes this read
    // job-addressed at all, so a fake that answered anyway would hide the defect (#286).
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
    // The run-addressed read this lane must never make: `gh` refuses it for the whole several
    // minutes lane 06's gate job runs, which is precisely when a re-judge needs recognising.
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
    // The conflict escalation (`shared/needs-human.ts`): seed the label, apply it, assign.
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
      // `verify-caller.yml`, never `verify.yml` — the file every real Verify run is recorded
      // against since the reusable-workflow split (ADR-0055, ADR-0132). The handler above
      // recognises any workflow file through `workflowRunsPathMatcher`, so this is only asserted
      // against directly where the test is about which file the lane asks for.
      verifyWorkflow: "verify-caller.yml",
      runGauntlet: () => {
        gauntletRuns += 1;
        return gauntlet;
      },
      // Counted, never waited on: `awaitVerifyVerdict` re-reads lane 06 while its gate job is
      // still running, and the production sleep would hold every one of these cases for minutes.
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

/** Every `pr merge` this run made — the one write a merge is, for assertions that it did not happen. */
export function mergeCalls(calls: string[][]): string[][] {
  return calls.filter((call) => call[0] === "pr" && call[1] === "merge");
}

/** Every comment left on the pull request, in order. */
export function prComments(calls: string[][]): string[][] {
  return calls.filter((call) => call[0] === "pr" && call[1] === "comment");
}
