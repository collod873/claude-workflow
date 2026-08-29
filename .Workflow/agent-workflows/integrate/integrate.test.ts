import { describe, expect, it } from "vitest";
import { readWorkflow } from "../shared/read-workflow";
import { createFakeGit } from "../shared/git.fake";
import {
  GRAPH_CHANGED_DISPATCH_ACTION,
  runIntegrate,
  VERIFY_DISPATCH_EVENT_TYPE,
  type CloseTicketResult,
  type GauntletResult,
} from "./integrate";

const PR = "https://github.com/owner/repo/pull/42";
const BRANCH = "implement/issue-42";
const TICKET = 190;
const TRUNK_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const RANGE = `${TRUNK_SHA}..${HEAD_SHA}`;

/** What lane 05's `openPrAndDispatch` writes: the implementer's summary, then the closing reference. */
const PR_BODY = `Rebuilt the thing.\n\nCloses #${TICKET}`;

interface IntegrateHarness {
  gauntlet?: GauntletResult;
  /** What the injected `closeTicket` seam answers; `undefined` means the test asserts it is never called. */
  closeTicket?: CloseTicketResult;
  /** The pull request body `gh pr view` answers with — overridden by the "names no ticket" case. */
  body?: string;
  /** Makes the ticket comment throw, standing in for a tracker write that fails after the merge. */
  commentThrows?: boolean;
}

/**
 * A minimal `GhExec` stand-in for this lane's own calls — `pr view` (the branch to rebase and the
 * ticket to close), `pr merge` (the one write a green run makes), the `graph-changed` doorbell,
 * and the `issue comment` a refused close leaves behind.
 * `shared/gh.fake.ts`'s `FakeGh` models a different consumer's endpoints
 * (sub-issues, blocked-by edges) and would throw on either of these, so this
 * test scripts its own rather than reusing it.
 */
function integrateDeps({ gauntlet = { exitCode: 0 }, closeTicket, body = PR_BODY, commentThrows = false }: IntegrateHarness = {}) {
  const fakeGit = createFakeGit((args) => {
    if (args[0] === "rev-parse") return `${args[1] === "HEAD" ? HEAD_SHA : TRUNK_SHA}\n`;
    return "";
  });
  const calls: string[][] = [];
  const closeCalls: Array<[number, string]> = [];

  const gh = (args: string[]): string => {
    calls.push(args);
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ headRefName: BRANCH, body });
    if (args[0] === "pr" && args[1] === "merge") return "";
    if (args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches") return "";
    if (args[0] === "issue" && args[1] === "comment") {
      if (commentThrows) throw new Error("gh: could not comment");
      return "";
    }
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return {
    fakeGit,
    calls,
    closeCalls,
    deps: {
      git: fakeGit.git,
      gh,
      pr: PR,
      runGauntlet: () => gauntlet,
      closeTicket: (ticket: number, range: string): CloseTicketResult => {
        closeCalls.push([ticket, range]);
        if (closeTicket === undefined) throw new Error("closeTicket called when the test expected none");
        return closeTicket;
      },
    },
  };
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

interface IntegrateWorkflow {
  on?: { repository_dispatch?: unknown };
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: { integrate: { if?: string } };
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
