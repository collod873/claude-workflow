import { describe, expect, it } from "vitest";
import { runJobsPathMatcher, workflowRunsPathMatcher } from "../shared/gh-paths";
import { readWorkflow } from "../shared/read-workflow";
import { createFakeGit } from "../shared/git.fake";
import {
  ACCEPTANCE_JOB,
  GRAPH_CHANGED_DISPATCH_ACTION,
  IMMUTABILITY_JOB,
  runIntegrate,
  VERIFY_DISPATCH_EVENT_TYPE,
  type CloseTicketResult,
  type GauntletResult,
} from "./integrate";

const PR = "https://github.com/owner/repo/pull/42";
const BRANCH = "implement/issue-42";
const TICKET = 190;
/**
 * Trunk's tip. It is `origin/main` in the rebased checkout *and* the `github.sha` both lane 06's
 * run and lane 08's run carry — a `repository_dispatch` run executes trunk's copy of the workflow
 * at trunk's tip (ADR-0054), which is the whole reason lane 08 can find lane 06 at all.
 */
const TRUNK_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const RANGE = `${TRUNK_SHA}..${HEAD_SHA}`;

/** What lane 05's `openPrAndDispatch` writes: the implementer's summary, then the closing reference. */
const PR_BODY = `Rebuilt the thing.\n\nCloses #${TICKET}`;

/** One job on a scripted `verify.yml` run, as the Actions jobs API reports it. */
interface VerifyJobFixture {
  name: string;
  /** `queued`, `in_progress` or `completed`; defaults to `completed`. */
  status?: string;
  /** `success`, `failure`, `skipped`, `cancelled`, … or `null` while it is still running. */
  conclusion?: string | null;
}

/** One scripted `verify.yml` run, as the Actions runs API reports it. */
interface VerifyRunFixture {
  id?: number;
  /** Defaults to `TRUNK_SHA` — the commit lane 08's own run carries. */
  headSha?: string;
  /** Defaults to `repository_dispatch`; `push` is the trunk run at the very same commit. */
  event?: string;
  jobs?: VerifyJobFixture[];
}

/** Lane 06 having judged this head commit and cleared both jobs. */
const LANE_06_ALL_GREEN: VerifyRunFixture[] = [
  {
    id: 900,
    jobs: [
      { name: IMMUTABILITY_JOB, conclusion: "success" },
      { name: ACCEPTANCE_JOB, conclusion: "success" },
    ],
  },
];

interface IntegrateHarness {
  gauntlet?: GauntletResult;
  /** What the injected `closeTicket` seam answers; `undefined` means the test asserts it is never called. */
  closeTicket?: CloseTicketResult;
  /** The pull request body `gh pr view` answers with — overridden by the "names no ticket" case. */
  body?: string;
  /** Makes the ticket comment throw, standing in for a tracker write that fails after the merge. */
  commentThrows?: boolean;
  /** Makes the pull-request comment throw, standing in for the acceptance warning failing to post. */
  prCommentThrows?: boolean;
  /**
   * What `verify.yml`'s run history answers with. Defaults to lane 06 having cleared both jobs.
   *
   * A function is re-evaluated on every lookup, which is how a test scripts a job that is still
   * running on one read and finished on the next — the case ADR-0104's wait exists for.
   */
  verifyRuns?: VerifyRunFixture[] | (() => VerifyRunFixture[]);
}

/**
 * A minimal `GhExec` stand-in for this lane's own calls — `pr view` (the branch to rebase and the
 * ticket to close), lane 06's run history and that run's jobs (the verdict this lane merges on),
 * `pr merge` (the one write a green run makes), the `graph-changed` doorbell, the `pr comment` a
 * non-binding acceptance red leaves behind, and the `issue comment` a refused close leaves behind.
 * `shared/gh.fake.ts`'s `FakeGh` models a different consumer's endpoints
 * (sub-issues, blocked-by edges) and would throw on either of these, so this
 * test scripts its own rather than reusing it.
 *
 * The two Actions endpoints are recognised through `gh-paths.ts`'s own matchers rather than
 * restated paths, so this fake cannot answer an endpoint different from the one `integrate.ts`
 * actually sends.
 */
function integrateDeps({
  gauntlet = { exitCode: 0 },
  closeTicket,
  body = PR_BODY,
  commentThrows = false,
  prCommentThrows = false,
  verifyRuns = LANE_06_ALL_GREEN,
}: IntegrateHarness = {}) {
  const fakeGit = createFakeGit((args) => {
    if (args[0] === "rev-parse") return `${args[1] === "HEAD" ? HEAD_SHA : TRUNK_SHA}\n`;
    return "";
  });
  const calls: string[][] = [];
  const closeCalls: Array<[number, string]> = [];

  // Resolved per lookup, not once: a `verifyRuns` function is how a test scripts lane 06 finishing
  // between two of this lane's reads.
  const currentRuns = () =>
    (typeof verifyRuns === "function" ? verifyRuns() : verifyRuns).map((run, index) => ({
      id: run.id ?? 900 + index,
      head_sha: run.headSha ?? TRUNK_SHA,
      event: run.event ?? "repository_dispatch",
      jobs: (run.jobs ?? []).map((job) => ({
        name: job.name,
        status: job.status ?? "completed",
        conclusion: job.conclusion ?? null,
      })),
    }));

  const gh = (args: string[]): string => {
    calls.push(args);
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ headRefName: BRANCH, body });
    if (args[0] === "pr" && args[1] === "merge") return "";
    if (args[0] === "pr" && args[1] === "comment") {
      if (prCommentThrows) throw new Error("gh: could not comment on the pull request");
      return "";
    }
    if (args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches") return "";
    if (args[0] === "api" && workflowRunsPathMatcher.test((args[1] ?? "").split("?")[0])) {
      return JSON.stringify(currentRuns().map(({ id, head_sha, event }) => ({ id, head_sha, event })));
    }
    const jobsMatch = (args[1] ?? "").match(runJobsPathMatcher);
    if (args[0] === "api" && jobsMatch) {
      return JSON.stringify(currentRuns().find((run) => run.id === Number(jobsMatch[1]))?.jobs ?? []);
    }
    if (args[0] === "issue" && args[1] === "comment") {
      if (commentThrows) throw new Error("gh: could not comment");
      return "";
    }
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  const sleeps: number[] = [];

  return {
    fakeGit,
    calls,
    closeCalls,
    sleeps,
    deps: {
      git: fakeGit.git,
      gh,
      pr: PR,
      headSha: TRUNK_SHA,
      runGauntlet: () => gauntlet,
      // Counted, never waited on: `awaitVerifyVerdict` re-reads lane 06 while its acceptance job is
      // still running, and the production sleep would hold every one of these cases for ten minutes.
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
function mergeCalls(calls: string[][]): string[][] {
  return calls.filter((call) => call[0] === "pr" && call[1] === "merge");
}

const CLOSED: CloseTicketResult = { exitCode: 0, output: "## Closing record\n" };
const REFUSED: CloseTicketResult = {
  exitCode: 1,
  output: "error: 4 acceptance criteria and every criterion unverified",
};

describe("runIntegrate", () => {
  it("rebases the PR's branch onto current trunk before doing anything else", () => {
    const { fakeGit, deps } = integrateDeps({ closeTicket: CLOSED });

    runIntegrate(deps);

    expect(fakeGit.calls.slice(0, 4)).toEqual([
      ["fetch", "origin", "main", BRANCH],
      ["checkout", BRANCH],
      ["rebase", "origin/main"],
      ["push", "--force-with-lease", "origin", `HEAD:${BRANCH}`],
    ]);
  });

  it("merges on a completed green verification run", () => {
    const { calls, deps } = integrateDeps({ closeTicket: CLOSED });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: true, ticket: TICKET } });
    const mergeCalls = calls.filter((call) => call[0] === "pr" && call[1] === "merge");
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]).toEqual(["pr", "merge", PR, "--merge", "--delete-branch"]);
  });

  it("produces no merge call on a completed red run", () => {
    const { calls, deps } = integrateDeps({ gauntlet: { exitCode: 1 } });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "red" });
    expect(calls.some((call) => call[0] === "pr" && call[1] === "merge")).toBe(false);
  });

  it("produces no merge call when there is no completed run at all, distinct from the red case", () => {
    const { calls, deps } = integrateDeps({ gauntlet: { exitCode: 2 } });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "no-run" });
    expect(calls.some((call) => call[0] === "pr" && call[1] === "merge")).toBe(false);
    // Distinct from the red case, not merely another way to spell "no merge".
    expect(outcome).not.toEqual({ merged: false, reason: "red" });
  });
});

/**
 * Lane 08 finishes the ticket it merged (#195).
 *
 * Before this, lane 08 merged and stopped: PR #193 landed carrying `Closes #190` and #190 stayed
 * open with no `## Closing record`, indistinguishable on the tracker from work nobody had started.
 * The two properties below are the whole guarantee — a ticket whose criteria verify gets closed by
 * the lane, and a ticket whose criteria do not stays open *without* reddening a merge that landed.
 */
describe("runIntegrate closes the ticket its merged pull request named", () => {
  it("closes the ticket the PR body names, against the merged commits, after the merge", () => {
    const { calls, closeCalls, deps } = integrateDeps({ closeTicket: CLOSED });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: true, ticket: TICKET } });
    // The range is the pull request's own commits — trunk as the rebase left it, to the rebased head.
    expect(closeCalls).toEqual([[TICKET, RANGE]]);
    // No comment of this lane's own: `bin/close-ticket` posts the record, so a second one here
    // would be the lane writing a closing note beside the record rather than through it.
    expect(calls.some((call) => call[0] === "issue" && call[1] === "comment")).toBe(false);
  });

  it("reads the range before the merge moves trunk", () => {
    const { fakeGit, deps } = integrateDeps({ closeTicket: CLOSED });

    runIntegrate(deps);

    // Both rev-parses sit after the rebase and before anything else: `origin/main` is only the
    // merge's parent in that window, since this checkout never fetches again.
    expect(fakeGit.calls.map((call) => call.join(" ")).slice(4)).toEqual([
      "rev-parse origin/main",
      "rev-parse HEAD",
    ]);
  });

  it("closes nothing when nothing merged", () => {
    for (const exitCode of [1, 2] as const) {
      const { closeCalls, deps } = integrateDeps({ gauntlet: { exitCode } });

      runIntegrate(deps);

      expect(closeCalls).toEqual([]);
    }
  });

  it("leaves the ticket open and the lane green when a criterion does not verify", () => {
    const { calls, deps } = integrateDeps({ closeTicket: REFUSED });

    const outcome = runIntegrate(deps);

    // Still merged: a criterion that did not check out does not un-land a merge.
    expect(outcome).toEqual({ merged: true, closing: { closed: false, reason: "refused", ticket: TICKET } });
    expect(calls.some((call) => call[0] === "pr" && call[1] === "merge")).toBe(true);
  });

  it("says so on the ticket when it refuses, quoting what close-ticket reported", () => {
    const { calls, deps } = integrateDeps({ closeTicket: REFUSED });

    runIntegrate(deps);

    const comments = calls.filter((call) => call[0] === "issue" && call[1] === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0].slice(0, 4)).toEqual(["issue", "comment", String(TICKET), "--body"]);
    expect(comments[0][4]).toContain(REFUSED.output);
    expect(comments[0][4]).toContain(PR);
  });

  it("treats a ticket whose every criterion is unverified as an ordinary refusal, not a failure", () => {
    // `bin/close-ticket` refuses to close on zero verified criteria (#215). That refusal reaches
    // this lane as a nonzero exit like any other, and must not be special-cased into a throw.
    const { deps } = integrateDeps({ closeTicket: REFUSED });

    expect(() => runIntegrate(deps)).not.toThrow();
  });

  it("stays merged and green when even the refusal comment fails", () => {
    const { deps } = integrateDeps({ closeTicket: REFUSED, commentThrows: true });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: false, reason: "refused", ticket: TICKET } });
  });

  it("merges and closes nothing when the pull request names no ticket", () => {
    const { closeCalls, deps } = integrateDeps({ body: "A branch somebody pushed by hand." });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: false, reason: "no-ticket" } });
    expect(closeCalls).toEqual([]);
  });

  it("reads the ticket out of the body rather than asking GitHub which issues the PR closes", () => {
    // GitHub recorded no `connected` event for #190 at all, which is why #193 merged and #190
    // stayed open — `closingIssuesReferences` would have answered the same empty answer.
    const { calls, deps } = integrateDeps({ closeTicket: CLOSED });

    runIntegrate(deps);

    const views = calls.filter((call) => call[0] === "pr" && call[1] === "view");
    expect(views).toHaveLength(1);
    expect(views[0].join(" ")).not.toContain("closingIssuesReferences");
  });
});

/**
 * The doorbell (#179).
 *
 * A merge is the thing that makes some other slice's last blocker deliver, and this lane is the only
 * thing that knows a merge happened. It says so and stops there. #178 proposed lane 08 promote its
 * successors and accepted a second lane reasoning about the graph as the cost; under a doorbell that
 * cost is not paid at all, which is what keeps ADR-0069 applied rather than amended.
 */
describe("runIntegrate announces the merge without interpreting it", () => {
  it("sends exactly one graph-changed naming the PR, after the merge", () => {
    const { calls, deps } = integrateDeps({ closeTicket: CLOSED });

    runIntegrate(deps);

    const dispatches = calls.filter((call) => call[0] === "api" && call[1] === "repos/{owner}/{repo}/dispatches");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toContain(`event_type=${GRAPH_CHANGED_DISPATCH_ACTION}`);
    expect(dispatches[0]).toContain(`client_payload[pr]=${PR}`);

    const mergeIndex = calls.findIndex((call) => call[0] === "pr" && call[1] === "merge");
    expect(mergeIndex).toBeGreaterThan(-1);
    expect(calls.indexOf(dispatches[0])).toBeGreaterThan(mergeIndex);
  });

  it("rings nothing when nothing merged", () => {
    for (const exitCode of [1, 2] as const) {
      const { calls, deps } = integrateDeps({ gauntlet: { exitCode } });

      runIntegrate(deps);

      expect(calls.filter((call) => call[0] === "api")).toEqual([]);
    }
  });

  it("makes no gh call that reads the dependency graph", () => {
    const { calls, deps } = integrateDeps({ closeTicket: CLOSED });

    runIntegrate(deps);

    expect(
      calls.filter((call) => call.some((arg) => arg.includes("dependencies/blocked_by"))),
      "the doorbell carries no graph read: ADR-0069 keeps the graph lane 03's",
    ).toEqual([]);
  });

  it("carries no payload beyond the pull request — no tracker read, no slice numbers", () => {
    const { calls, deps } = integrateDeps({ closeTicket: CLOSED });

    runIntegrate(deps);

    const dispatch = calls.find((call) => call[1] === "repos/{owner}/{repo}/dispatches") ?? [];
    const payloadFields = dispatch.filter((arg) => arg.startsWith("client_payload["));
    expect(payloadFields).toEqual([`client_payload[pr]=${PR}`]);
  });
});

/**
 * Lane 08 reads lane 06's verdict before it merges (#197).
 *
 * Before this, `verify.yml` run 33227183464 finished **failure** and `integrate.yml` run
 * 33227183471 merged [#193](https://github.com/collod873/claude-workflow/pull/193) anyway — the two
 * lanes ride the same dispatch in parallel and nothing made the merge actor look. The failing job
 * that time was the acceptance one, which this lane rules does not bind; a red `Immutability` job
 * would have been merged over in exactly the same way, and that one does.
 */
describe("runIntegrate reads lane 06's immutability verdict before merging", () => {
  it("refuses to merge when lane 06's immutability job failed for this head commit", () => {
    const { calls, closeCalls, deps } = integrateDeps({
      verifyRuns: [{ jobs: [{ name: IMMUTABILITY_JOB, conclusion: "failure" }] }],
    });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "immutable-set" });
    expect(mergeCalls(calls)).toEqual([]);
    // Nothing downstream of the merge happens either: no doorbell, no close.
    expect(calls.some((call) => call[1] === "repos/{owner}/{repo}/dispatches")).toBe(false);
    expect(closeCalls).toEqual([]);
  });

  it("refuses even though its own gauntlet came back green, so the two verdicts are not interchangeable", () => {
    const { deps } = integrateDeps({
      gauntlet: { exitCode: 0 },
      verifyRuns: [{ jobs: [{ name: IMMUTABILITY_JOB, conclusion: "failure" }] }],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "immutable-set" });
  });

  // The green case is the harness default (`LANE_06_ALL_GREEN`), so every merge asserted above —
  // "merges on a completed green verification run" and the closing tests — is already a merge that
  // read a completed, successful `Immutability` job. It is not restated here.

  it("reads the verdict against its own head commit, and asks lane 06's own workflow for it", () => {
    const { calls, deps } = integrateDeps({ closeTicket: CLOSED });

    runIntegrate(deps);

    const runsRead = calls.find((call) => workflowRunsPathMatcher.test((call[1] ?? "").split("?")[0]));
    expect(runsRead, "no read of verify.yml's own run history").toBeDefined();
    expect((runsRead ?? [])[1]).toContain("verify.yml");
    // And the jobs of the run that matched, by id — never a guess from the runs listing alone.
    expect(calls.some((call) => runJobsPathMatcher.test(call[1] ?? ""))).toBe(true);
  });

  it("spends nothing on the lookup until its own gauntlet has reported green", () => {
    // The immutable-set alarm is cheap and this lane's gauntlet is not, but the ordering is the
    // other way round on purpose: lane 06 runs in parallel and would still be starting.
    const lookups = ([1, 2] as const).flatMap((exitCode) => {
      const { calls, deps } = integrateDeps({ gauntlet: { exitCode } });
      runIntegrate(deps);
      return calls.filter((call) => workflowRunsPathMatcher.test((call[1] ?? "").split("?")[0]));
    });

    expect(lookups, "lane 06's run history was read on a run that was never going to merge").toEqual([]);
  });
});

/**
 * The third case ADR-0054 names, and the one that is not "no red check": a head commit lane 06 has
 * not finished judging. A skipped, cancelled, queued or still-running job has said nothing, and
 * `verify.yml`'s own downstream `if: always() && needs.immutability.result != 'failure'` reads a
 * skip as permission to continue — a reading that is right for a job in the same run and wrong for
 * a lane deciding whether to merge.
 */
describe("runIntegrate refuses a head commit lane 06 has not judged", () => {
  it("refuses when no dispatch run of verify.yml carries this head commit", () => {
    const { calls, deps } = integrateDeps({ verifyRuns: [] });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "unjudged" });
    expect(mergeCalls(calls)).toEqual([]);
    // Distinct from a failed immutability job, not merely another way to spell "no merge".
    expect(outcome).not.toEqual({ merged: false, reason: "immutable-set" });
  });

  it("refuses while the immutability job is still running", () => {
    const { deps } = integrateDeps({
      verifyRuns: [{ jobs: [{ name: IMMUTABILITY_JOB, status: "in_progress", conclusion: null }] }],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "unjudged" });
  });

  it("does not read a skipped immutability job as a pass", () => {
    const { deps } = integrateDeps({
      verifyRuns: [{ jobs: [{ name: IMMUTABILITY_JOB, conclusion: "skipped" }] }],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "unjudged" });
  });

  it("ignores the push run at the same commit, whose immutability job is skipped by its own gate", () => {
    // `verify.yml` also fires on `push: main`, and the push that produced this trunk tip ran at
    // exactly this SHA — with `Immutability` skipped, because that job is gated on the dispatch.
    // Matching on the commit alone would hand this lane that run to read.
    const { deps } = integrateDeps({
      verifyRuns: [{ event: "push", jobs: [{ name: IMMUTABILITY_JOB, conclusion: "skipped" }] }],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "unjudged" });
  });

  it("ignores a dispatch run for a different head commit", () => {
    const { deps } = integrateDeps({
      verifyRuns: [{ headSha: HEAD_SHA, jobs: [{ name: IMMUTABILITY_JOB, conclusion: "success" }] }],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "unjudged" });
  });

  it("takes the strictest verdict when two dispatch runs share this head commit", () => {
    // Two implementers dispatching off the same trunk tip are indistinguishable from here — a
    // dispatch run's `pull_requests` is empty — so a failure anywhere on the commit holds the merge.
    const { deps } = integrateDeps({
      verifyRuns: [
        { id: 901, jobs: [{ name: IMMUTABILITY_JOB, conclusion: "success" }] },
        { id: 902, jobs: [{ name: IMMUTABILITY_JOB, conclusion: "failure" }] },
      ],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "immutable-set" });
  });
});

/**
 * The ruling on the other half of lane 06, as ADR-0104 leaves it: `Restore and run acceptance`
 * binds. ADR-0095 waved it through while lane 04's first-authoring was unwired (#201) — the job
 * was red for every pull request then, and binding on it would have stopped the chain rather than
 * caught anything. #201 has landed, so a red one now means the slice's own acceptance tests do not
 * pass against the diff, which is the one thing this lane exists not to merge.
 */
describe("runIntegrate's ruling when only lane 06's acceptance job is red", () => {
  const ACCEPTANCE_RED: VerifyRunFixture[] = [
    {
      jobs: [
        { name: IMMUTABILITY_JOB, conclusion: "success" },
        { name: ACCEPTANCE_JOB, conclusion: "failure" },
      ],
    },
  ];

  it("refuses the merge", () => {
    const { calls, deps } = integrateDeps({ verifyRuns: ACCEPTANCE_RED });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "acceptance" });
    expect(mergeCalls(calls)).toEqual([]);
  });

  it("says on the pull request that the job was red, so the refusal is not only a run log", () => {
    const { calls, deps } = integrateDeps({ verifyRuns: ACCEPTANCE_RED });

    runIntegrate(deps);

    const comments = calls.filter((call) => call[0] === "pr" && call[1] === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0].slice(0, 4)).toEqual(["pr", "comment", PR, "--body"]);
    expect(comments[0][4]).toContain(ACCEPTANCE_JOB);
    // Says what to do about it — a refusal nothing retries has to name its own next step.
    expect(comments[0][4]).toContain("Re-dispatch");
  });

  it("says nothing on the pull request when lane 06 cleared both jobs", () => {
    const { calls, deps } = integrateDeps({ closeTicket: CLOSED });

    runIntegrate(deps);

    expect(calls.filter((call) => call[0] === "pr" && call[1] === "comment")).toEqual([]);
  });

  it("still refuses when the explanatory comment itself fails to post", () => {
    const { calls, deps } = integrateDeps({ verifyRuns: ACCEPTANCE_RED, prCommentThrows: true });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "acceptance" });
    expect(mergeCalls(calls)).toEqual([]);
  });

  /**
   * The race ADR-0104's wait exists for. `Restore and run acceptance` is a checkout, an `npm ci`
   * and a vitest run — the same order of minutes this lane spends on its own rebase and gauntlet —
   * so a single read can easily catch it mid-run. Reading that as "unjudged" would refuse a pull
   * request for being slow rather than for being wrong.
   */
  it("waits for an acceptance job still running, rather than refusing the pull request for it", () => {
    let reads = 0;
    const { calls, deps, sleeps } = integrateDeps({
      closeTicket: CLOSED,
      // Green only from the third read on; before that the job has not concluded.
      verifyRuns: () => {
        reads += 1;
        return [
          {
            jobs: [
              { name: IMMUTABILITY_JOB, conclusion: "success" },
              reads < 3
                ? { name: ACCEPTANCE_JOB, status: "in_progress", conclusion: null }
                : { name: ACCEPTANCE_JOB, conclusion: "success" },
            ],
          },
        ];
      },
    });

    expect(runIntegrate(deps)).toEqual({ merged: true, closing: { closed: true, ticket: TICKET } });
    expect(mergeCalls(calls)).toHaveLength(1);
    expect(sleeps.length, "waited between reads rather than spinning on the API").toBeGreaterThan(0);
  });

  it("gives up rather than waiting forever, and a merge is never what giving up produces", () => {
    const { calls, deps, sleeps } = integrateDeps({
      verifyRuns: [
        {
          jobs: [
            { name: IMMUTABILITY_JOB, conclusion: "success" },
            { name: ACCEPTANCE_JOB, status: "in_progress", conclusion: null },
          ],
        },
      ],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "unjudged" });
    expect(mergeCalls(calls)).toEqual([]);
    expect(sleeps.length, "the wait is bounded").toBeLessThan(100);
  });

  it("still refuses when the acceptance job is red and the immutability job is too", () => {
    const { deps } = integrateDeps({
      verifyRuns: [
        {
          jobs: [
            { name: IMMUTABILITY_JOB, conclusion: "failure" },
            { name: ACCEPTANCE_JOB, conclusion: "failure" },
          ],
        },
      ],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "immutable-set" });
  });
});

interface VerifyWorkflow {
  jobs: Record<string, { name?: string }>;
}

/**
 * The Actions API answers job *names*, and `shared/` may not import a workflow file — so
 * `integrate.ts` spells lane 06's two job names itself. This is the assertion that keeps the two
 * spellings from drifting, the same split `immutable-set.ts` holds to for `IMMUTABLE_SET`: a
 * renamed job in `verify.yml` would otherwise make every lookup here find nothing, which reads as
 * `unjudged` and silently stops every merge in the fleet.
 */
describe("the lane 06 job names integrate.ts reads are verify.yml's own", () => {
  const { workflow } = readWorkflow<VerifyWorkflow>("verify.yml");
  const names = Object.values(workflow.jobs).map((job) => job.name);

  it("names the immutability job exactly as verify.yml does", () => {
    expect(names).toContain(IMMUTABILITY_JOB);
  });

  it("names the acceptance job exactly as verify.yml does", () => {
    expect(names).toContain(ACCEPTANCE_JOB);
  });
});

interface IntegrateWorkflow {
  on?: { repository_dispatch?: unknown };
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: { integrate: { if?: string; env?: Record<string, string>; steps?: Array<{ name?: string; run?: string }> } };
}

/**
 * DESIGN.md §10's "exactly one merge at a time" is a claim about every pull request this lane
 * could ever touch, not one per branch or per PR — so the concurrency group must be a single fixed
 * name, never interpolated on anything about the event, or two completed-green dispatches for two
 * different pull requests would still be free to merge in parallel.
 */
describe("integrate.yml's concurrency group", () => {
  const { workflow } = readWorkflow<IntegrateWorkflow>("integrate.yml");

  it("declares a concurrency group", () => {
    expect(workflow.concurrency, "no top-level concurrency: block").toBeDefined();
    expect(workflow.concurrency?.group, "no concurrency.group").toBeTruthy();
  });

  it("names a fixed group with no per-event interpolation, so two completed-green events cannot merge simultaneously", () => {
    expect(workflow.concurrency?.group).not.toMatch(/\$\{\{/);
  });

  it("does not cancel a queued run in favour of a newer one", () => {
    // Cancelling would let a second dispatch's merge preempt a first one still rebasing/gauntleting
    // — exactly the "more than one merge at a time" this group exists to rule out.
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("gates its job on the same repository_dispatch action integrate.ts re-exports", () => {
    expect(workflow.jobs.integrate.if).toBe(`github.event.action == '${VERIFY_DISPATCH_EVENT_TYPE}'`);
  });
});

/**
 * The token this lane runs as has to be able to finish a ticket, not only merge a pull request
 * (#195). A `permissions:` block replaces the default token rather than adding to it
 * (`shared/workflow-permissions.test.ts`), so an omitted `issues:` scope is `issues: none` — and
 * the failure lands after the merge, in a lane nobody is watching, on the one step whose whole
 * purpose is leaving a record.
 */
describe("integrate.yml's token can close a ticket", () => {
  const { workflow } = readWorkflow<IntegrateWorkflow>("integrate.yml");

  it("grants issues: write, the scope bin/close-ticket's comment and close both need", () => {
    expect(workflow.permissions?.issues).toBe("write");
  });
});

/**
 * `integrate.yml` has to hand `integrate.ts` the head commit and the scope to look it up, and it
 * has to state the ruling on the acceptance job where the next reader of the workflow will meet it
 * (#197's second criterion). A ruling that lives only in the code is the thing the ticket asks not
 * to be built: the reason lane 08 merges over a red job has to be findable from the lane itself.
 */
describe("integrate.yml wires and states lane 08's reading of lane 06", () => {
  const { workflow, source } = readWorkflow<IntegrateWorkflow>("integrate.yml");
  const step = (workflow.jobs.integrate.steps ?? []).find((each) => each.run?.includes("integrate.ts"));

  it("grants actions: read, without which the verdict lookup 403s after the gauntlet has run", () => {
    expect(workflow.permissions?.actions).toBe("read");
  });

  it("passes this run's own head commit through to integrate.ts", () => {
    expect(workflow.jobs.integrate.env?.HEAD_SHA).toBe("${{ github.sha }}");
    expect(step?.run).toContain('"$HEAD_SHA"');
  });

  it("states in a comment that the acceptance job binds, and names what changed", () => {
    expect(source).toContain(ACCEPTANCE_JOB);
    expect(source).toContain("binds too");
    // The ruling it replaces and the fact that retired it, so a reader can follow the change.
    expect(source).toContain("ADR-0095");
    expect(source).toContain("#201");
  });

  it("states in the same comment that the immutability job does block", () => {
    expect(source).toContain(`\`${IMMUTABILITY_JOB}\` blocks outright`);
  });
});
