import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { issueCommentPathMatcher, issueCommentsPathMatcher, matchingRefsPath, subIssuesPathMatcher } from "../shared/gh-paths";
import { readWorkflow } from "../shared/read-workflow";
import { GRAPH_CHANGED_DISPATCH_ACTION, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import { FINDING_MARKER, retirementBody } from "../watchdog/unreachable";
import {
  deliveryOf,
  RECONCILE_DISPATCH_ACTIONS,
  runReconcile,
  SESSION_CAPTURED_DISPATCH_ACTION,
} from "./reconcile";

/** A published slice's body — `render-body.ts` writes this heading and nothing else does. */
function sliceBody(prd = 145): string {
  return `## Parent PRD\n#${prd}\n\n## What to build\nSomething.\n`;
}

interface FakeIssue {
  number: number;
  title: string;
  /** Defaults to a published-slice body; pass a bare string for a hand-written issue. */
  body?: string;
  blockedBy?: number[];
  /** Label names, as `prd` and `needs-human` are spelled on the tracker. */
  labels?: string[];
  /** Comment bodies already standing on the issue, oldest first. */
  comments?: string[];
  /** Sub-issue numbers — what puts a `prd` issue in the spec-evaluate pass's scope. */
  children?: number[];
}

interface FakeClosed {
  number: number;
  stateReason: "completed" | "not_planned";
  /** Whether a merged pull request closed it. */
  merged?: boolean;
}

interface FakeOptions {
  open: FakeIssue[];
  closed?: FakeClosed[];
  /** Branch refs that already exist, as `implement/issue-<n>`. */
  claimed?: string[];
  standing?: { number: number; body: string; comments?: string[] };
  /** Endpoints that should throw, to exercise the degraded paths. */
  fail?: "issues" | "refs" | "edges";
}

interface FakeGh {
  gh: GhExec;
  calls: string[][];
  dispatches: number[];
  comments: Array<{ issue: number; body: string }>;
  created: Array<{ title: string; body: string }>;
  closedByRun: Array<{ issue: number; reason: string }>;
  /** Every comment rewritten whole via `gh api ... -X PATCH`, by the id the fake handed out. */
  commentEdits: Array<{ id: number; body: string }>;
  labelsAdded: Array<{ issue: number; name: string }>;
  labelsRemoved: Array<{ issue: number; name: string }>;
}

function createFake(options: FakeOptions): FakeGh {
  const calls: string[][] = [];
  const dispatches: number[] = [];
  const comments: Array<{ issue: number; body: string }> = [];
  const created: Array<{ title: string; body: string }> = [];
  const closedByRun: Array<{ issue: number; reason: string }> = [];
  const commentEdits: Array<{ id: number; body: string }> = [];
  const labelsAdded: Array<{ issue: number; name: string }> = [];
  const labelsRemoved: Array<{ issue: number; name: string }> = [];
  const closed = new Map((options.closed ?? []).map((issue) => [issue.number, issue]));
  const open = new Map(options.open.map((issue) => [issue.number, issue]));

  const gh: GhExec = (args) => {
    calls.push([...args]);

    if (args[0] === "issue" && args[1] === "list") {
      const fields = args[args.indexOf("--json") + 1] ?? "";
      if (fields.includes("comments")) {
        const standing = options.standing;
        return JSON.stringify(
          standing
            ? [
                {
                  number: standing.number,
                  body: standing.body,
                  comments: (standing.comments ?? []).map((body) => ({ body })),
                },
              ]
            : [],
        );
      }
      if (options.fail === "issues") throw new Error("gh: 403");
      return JSON.stringify(
        options.open.map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body ?? sliceBody(),
          labels: (issue.labels ?? []).map((name) => ({ name })),
        })),
      );
    }

    if (args[0] === "issue" && args[1] === "view") {
      const number = Number(args[2]);
      const record = closed.get(number);
      return JSON.stringify(record?.merged ? ["MERGED"] : []);
    }

    if (args[0] === "issue" && args[1] === "comment") {
      comments.push({ issue: Number(args[2]), body: args[args.indexOf("--body") + 1] });
      return "";
    }

    if (args[0] === "issue" && args[1] === "close") {
      closedByRun.push({ issue: Number(args[2]), reason: args[args.indexOf("--reason") + 1] });
      return "";
    }

    if (args[0] === "issue" && args[1] === "edit") {
      const issue = Number(args[2]);
      const add = args[args.indexOf("--add-label") + 1];
      const remove = args[args.indexOf("--remove-label") + 1];
      if (args.includes("--add-label")) labelsAdded.push({ issue, name: add });
      if (args.includes("--remove-label")) labelsRemoved.push({ issue, name: remove });
      return "";
    }

    if (args[0] === "issue" && args[1] === "create") {
      created.push({
        title: args[args.indexOf("--title") + 1],
        body: args[args.indexOf("--body") + 1],
      });
      return "https://github.com/owner/repo/issues/500\n";
    }

    if (args[0] === "api") {
      const path = args[1] ?? "";

      if (path === matchingRefsPath("implement/")) {
        if (options.fail === "refs") throw new Error("gh: 403");
        return JSON.stringify((options.claimed ?? []).map((branch) => `refs/heads/${branch}`));
      }

      if (path === "repos/{owner}/{repo}/dispatches") {
        const field = args.find((arg) => arg.startsWith("client_payload[issue]="));
        dispatches.push(Number(field?.split("=")[1]));
        return "";
      }

      const commentPatch = issueCommentPathMatcher.exec(path);
      if (commentPatch) {
        const body = args[args.indexOf("-f") + 1]?.replace(/^body=/, "") ?? "";
        commentEdits.push({ id: Number(commentPatch[1]), body });
        return "{}";
      }

      const commentsList = issueCommentsPathMatcher.exec(path);
      if (commentsList) {
        const bodies = open.get(Number(commentsList[1]))?.comments ?? [];
        return JSON.stringify(bodies.map((body, index) => ({ id: Number(commentsList[1]) * 1000 + index, body })));
      }

      const edges = /\/issues\/(\d+)\/dependencies\/blocked_by$/.exec(path);
      if (edges) {
        if (options.fail === "edges") throw new Error("gh: 403");
        const blockers = open.get(Number(edges[1]))?.blockedBy ?? [];
        return JSON.stringify(
          blockers.map((number) => {
            const record = closed.get(number);
            return record
              ? { number, state: "closed", state_reason: record.stateReason }
              : { number, state: "open", state_reason: null };
          }),
        );
      }

      const subIssues = subIssuesPathMatcher.exec(path);
      if (subIssues) {
        const children = open.get(Number(subIssues[1]))?.children ?? [];
        return JSON.stringify(children.map((number) => ({ number })));
      }
    }

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, dispatches, comments, created, closedByRun, commentEdits, labelsAdded, labelsRemoved };
}

const silent = () => {};

describe("deliveryOf", () => {
  it("reads an open blocker as open", () => {
    expect(deliveryOf({ number: 1, state: "open", state_reason: null }, () => false)).toBe("open");
  });

  it("reads a blocker closed as completed with a merged PR as delivered", () => {
    expect(deliveryOf({ number: 1, state: "closed", state_reason: "completed" }, () => true)).toBe("delivered");
  });

  it("reads a blocker closed as completed with nothing merged as undelivered", () => {
    expect(deliveryOf({ number: 1, state: "closed", state_reason: "completed" }, () => false)).toBe("undelivered");
  });

  it("reads a blocker closed `not planned` as undelivered without asking about pull requests", () => {
    let asked = false;
    const delivery = deliveryOf({ number: 1, state: "closed", state_reason: "not_planned" }, () => {
      asked = true;
      return true;
    });

    expect(delivery).toBe("undelivered");
    expect(asked, "a `not planned` close is undelivered whatever merged").toBe(false);
  });
});

describe("runReconcile dispatches the wave nothing was sending", () => {
  it("dispatches ticket-ready for a slice whose every blocker closed with a merged PR", () => {
    const fake = createFake({
      open: [{ number: 20, title: "Second wave", blockedBy: [10, 11] }],
      closed: [
        { number: 10, stateReason: "completed", merged: true },
        { number: 11, stateReason: "completed", merged: true },
      ],
    });

    const outcome = runReconcile({ gh: fake.gh, log: silent });

    expect(outcome.action).toBe("dispatched");
    expect(fake.dispatches).toEqual([20]);
  });

  it("dispatches nothing for a slice with one merged and one open blocker", () => {
    const fake = createFake({
      open: [
        { number: 11, title: "Still building" },
        { number: 20, title: "Second wave", blockedBy: [10, 11] },
      ],
      closed: [{ number: 10, stateReason: "completed", merged: true }],
    });

    const outcome = runReconcile({ gh: fake.gh, log: silent });

    expect(fake.dispatches).not.toContain(20);
    expect(outcome.action).toBe("dispatched");
    // #11 is itself a ready root, which is why the run is not `clear` — but #20 is not in it.
    expect(fake.dispatches).toEqual([11]);
  });

  it("does not dispatch a slice that already has an implement/issue-<n> ref", () => {
    const fake = createFake({
      open: [{ number: 20, title: "Already claimed", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "completed", merged: true }],
      claimed: ["implement/issue-20"],
    });

    const outcome = runReconcile({ gh: fake.gh, log: silent });

    expect(fake.dispatches).toEqual([]);
    expect(outcome.action).toBe("clear");
  });

  /**
   * The scope rule, and it is a safety rule. Being in the graph is what makes an issue ready; being
   * a slice lane 03 published is what makes it something an implementer may be pointed at. Without
   * this, every unblocked issue on the tracker — this ticket included — would get a Sonnet run and
   * a pull request.
   */
  it("never dispatches an issue lane 03 did not publish, however ready it looks", () => {
    const fake = createFake({
      open: [
        { number: 30, title: "A hand-written idea", body: "## What to build\nSomething I typed." },
        { number: 31, title: "A published slice" },
      ],
    });

    runReconcile({ gh: fake.gh, log: silent });

    expect(fake.dispatches).toEqual([31]);
  });

  it("reads the dependency graph and writes nothing to it", () => {
    const fake = createFake({
      open: [{ number: 20, title: "Second wave", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "completed", merged: true }],
    });

    runReconcile({ gh: fake.gh, log: silent });

    const graphWrites = fake.calls.filter(
      (call) => call[1]?.endsWith("/dependencies/blocked_by") && (call.includes("-F") || call.includes("-f")),
    );
    expect(graphWrites, "ADR-0069: the graph is lane 03's output, read-only downstream").toEqual([]);
  });

  it("dispatches nothing at all in a dry run", () => {
    const fake = createFake({
      open: [{ number: 20, title: "Second wave", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "completed", merged: true }],
    });

    const outcome = runReconcile({ gh: fake.gh, log: silent, dryRun: true });

    expect(outcome.dispatched).toEqual([20]);
    expect(fake.dispatches).toEqual([]);
  });
});

describe("runReconcile reports what became unreachable", () => {
  it("files a slice transitively behind a blocker closed without delivering, as one issue rather than one per slice", () => {
    const fake = createFake({
      open: [
        { number: 20, title: "Behind the abandoned one", blockedBy: [10] },
        { number: 21, title: "Behind that", blockedBy: [20] },
      ],
      closed: [{ number: 10, stateReason: "not_planned" }],
    });

    const outcome = runReconcile({ gh: fake.gh, log: silent });

    expect(outcome.unreachable.sort()).toEqual([20, 21]);
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].body).toContain("#20 —");
    expect(fake.created[0].body).toContain("#21 —");
    expect(fake.created[0].body).toContain(FINDING_MARKER);
  });

  it("comments on the standing issue rather than opening a second one", () => {
    const fake = createFake({
      open: [{ number: 20, title: "Behind the abandoned one", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "not_planned" }],
      standing: { number: 400, body: `Already standing.\n\n${FINDING_MARKER}` },
    });

    runReconcile({ gh: fake.gh, log: silent });

    expect(fake.created).toEqual([]);
    expect(fake.comments).toHaveLength(1);
    expect(fake.comments[0].issue).toBe(400);
    expect(fake.comments[0].body).toContain("#20 —");
    // And leaves it open: the report is only retired at a count of zero (ADR-0099).
    expect(fake.closedByRun).toEqual([]);
  });

  it("says nothing twice about a slice the standing issue already names", () => {
    const fake = createFake({
      open: [{ number: 20, title: "Behind the abandoned one", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "not_planned" }],
      standing: { number: 400, body: `#20 — Behind the abandoned one\n\n${FINDING_MARKER}` },
    });

    const outcome = runReconcile({ gh: fake.gh, log: silent });

    expect(fake.comments).toEqual([]);
    expect(fake.created).toEqual([]);
    expect(outcome.unreachable).toEqual([]);
  });

  it("files nothing when everything is merely waiting", () => {
    const fake = createFake({
      open: [
        { number: 11, title: "Still building" },
        { number: 20, title: "Waiting on it", blockedBy: [11] },
      ],
    });

    const outcome = runReconcile({ gh: fake.gh, log: silent });

    expect(outcome.unreachable).toEqual([]);
    expect(fake.created).toEqual([]);
    expect(fake.comments).toEqual([]);
    expect(fake.closedByRun).toEqual([]);
  });
});

describe("runReconcile closes the standing report once nothing is unreachable", () => {
  /** Nothing unreachable — #20 is merely waiting on an open blocker. */
  const waiting = (standing?: FakeOptions["standing"]) =>
    createFake({
      open: [
        { number: 11, title: "Still building" },
        { number: 20, title: "Waiting on it", blockedBy: [11] },
      ],
      standing,
    });

  it("closes it, so a report that named slices which then delivered cannot outlive them (#216)", () => {
    const fake = waiting({ number: 400, body: `#20 — Was unreachable\n\n${FINDING_MARKER}` });

    runReconcile({ gh: fake.gh, log: silent });

    expect(fake.closedByRun).toEqual([{ issue: 400, reason: "completed" }]);
  });

  it("posts a closing record first, so the close gate's grammar is satisfied by the mechanism", () => {
    const fake = waiting({ number: 400, body: `#20 — Was unreachable\n\n${FINDING_MARKER}` });

    runReconcile({ gh: fake.gh, log: silent });

    expect(fake.comments).toEqual([{ issue: 400, body: retirementBody() }]);
    // Ordered: the record has to exist before the close, or the gate reads a close with no record.
    const order = fake.calls.filter((call) => call[0] === "issue").map((call) => call[1]);
    expect(order.indexOf("comment")).toBeLessThan(order.indexOf("close"));
  });

  it("closes nothing in a dry run", () => {
    const fake = waiting({ number: 400, body: `#20 — Was unreachable\n\n${FINDING_MARKER}` });

    runReconcile({ gh: fake.gh, log: silent, dryRun: true });

    expect(fake.closedByRun).toEqual([]);
    expect(fake.comments).toEqual([]);
  });

  it("keeps its answer when the close will not go through, because the next recompute retries it", () => {
    const fake = waiting({ number: 400, body: `#20 — Was unreachable\n\n${FINDING_MARKER}` });
    const refusing: GhExec = (args) => {
      if (args[0] === "issue" && args[1] === "close") throw new Error("gh: 403");
      return fake.gh(args);
    };

    const outcome = runReconcile({ gh: refusing, log: silent });

    expect(outcome.action).not.toBe("degraded");
    expect(outcome.unreachable).toEqual([]);
  });
});

describe("runReconcile refuses to answer when it cannot read its own inputs", () => {
  it("is degraded when the tracker will not list open issues", () => {
    const fake = createFake({ open: [], fail: "issues" });

    expect(runReconcile({ gh: fake.gh, log: silent }).action).toBe("degraded");
    expect(fake.dispatches).toEqual([]);
  });

  it("is degraded when the refs API will not say which slices are claimed", () => {
    // Without it every slice reads as unstarted, which is the direction that dispatches duplicates.
    const fake = createFake({ open: [{ number: 20, title: "A slice" }], fail: "refs" });

    expect(runReconcile({ gh: fake.gh, log: silent }).action).toBe("degraded");
    expect(fake.dispatches).toEqual([]);
  });

  it("is degraded when the dependency graph cannot be read", () => {
    const fake = createFake({ open: [{ number: 20, title: "A slice" }], fail: "edges" });

    expect(runReconcile({ gh: fake.gh, log: silent }).action).toBe("degraded");
    expect(fake.dispatches).toEqual([]);
  });
});

describe("runReconcile's spec-evaluate pass (#237)", () => {
  const RUNNABLE_BODY = [
    "## Acceptance criteria",
    "",
    "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
    "",
  ].join("\n");

  const UNRUNNABLE_BODY = [
    "## Acceptance criteria",
    "",
    "- [ ] I'll know it works when I can see a verdict — check: `true`",
    "- [ ] And also when I can see the second thing — check: `true`",
    "",
  ].join("\n");

  /**
   * One reconcile pass over a tracker holding exactly one open issue, returning the fake for the
   * assertions. Every case in this block differs only in the issue it starts from and the verdict
   * it expects, so the pass itself is written once.
   */
  function passOver(issue: FakeIssue): FakeGh {
    const fake = createFake({ open: [issue] });
    runReconcile({ gh: fake.gh, log: silent });
    return fake;
  }

  /** Every write — a fresh `issue comment` or a rewritten `commentEdits` entry — carrying `marker`. */
  function commentsCarrying(fake: FakeGh, marker: string): string[] {
    return [...fake.comments.map((entry) => entry.body), ...fake.commentEdits.map((entry) => entry.body)].filter(
      (body) => body.includes(marker),
    );
  }

  it("upserts prd-check:v1 for a runnable spec with a sub-issue, and writes neither prd-unrunnable:v1 nor needs-human", () => {
    const fake = createFake({
      open: [{ number: 300, title: "A spec", body: RUNNABLE_BODY, labels: ["prd"], children: [301] }],
    });

    runReconcile({ gh: fake.gh, log: silent });

    expect(commentsCarrying(fake, "prd-check:v1").length).toBeGreaterThan(0);
    expect(commentsCarrying(fake, "prd-unrunnable:v1")).toEqual([]);
    expect(fake.labelsAdded.map((entry) => entry.name)).not.toContain("needs-human");
  });

  it("upserts prd-unrunnable:v1 and needs-human for a spec whose body cannot run, and never prd-check:v1", () => {
    const fake = createFake({
      open: [{ number: 310, title: "A spec", body: UNRUNNABLE_BODY, labels: ["prd"], children: [311] }],
    });

    runReconcile({ gh: fake.gh, log: silent });

    expect(commentsCarrying(fake, "prd-unrunnable:v1").length).toBeGreaterThan(0);
    expect(commentsCarrying(fake, "prd-check:v1")).toEqual([]);
    expect(fake.labelsAdded.map((entry) => entry.name)).toContain("needs-human");
  });

  it("never evaluates a prd issue that has grown no sub-issue yet", () => {
    const fake = passOver({
      number: 320,
      title: "A spec still being sliced",
      body: RUNNABLE_BODY,
      labels: ["prd"],
      children: [],
    });

    expect(commentsCarrying(fake, "prd-check:v1")).toEqual([]);
    expect(commentsCarrying(fake, "prd-unrunnable:v1")).toEqual([]);
  });

  it("never evaluates an open issue that isn't labelled prd, however ready it looks", () => {
    const fake = passOver({ number: 325, title: "Not a spec", body: RUNNABLE_BODY, labels: [], children: [326] });

    expect(commentsCarrying(fake, "prd-check:v1")).toEqual([]);
    expect(commentsCarrying(fake, "prd-unrunnable:v1")).toEqual([]);
  });

  it("clears the needs-human it set, in the same act that rewrites its own refusal to a verdict", () => {
    const fake = passOver({
      number: 330,
      title: "A spec fixed since the last session",
      body: RUNNABLE_BODY,
      labels: ["prd", "needs-human"],
      comments: ["Could not run this spec's check: its body carried two criteria.\n\n<!-- prd-unrunnable:v1 -->"],
      children: [331],
    });

    expect(commentsCarrying(fake, "prd-check:v1").length).toBeGreaterThan(0);
    expect(fake.labelsRemoved).toEqual([{ issue: 330, name: "needs-human" }]);
  });

  it("leaves a needs-human another lane wrote alone, even while writing that spec's verdict", () => {
    const fake = passOver({
      number: 340,
      title: "A spec another lane flagged",
      body: RUNNABLE_BODY,
      labels: ["prd", "needs-human"],
      // No prd-unrunnable:v1 anywhere on it — this needs-human isn't paired with this pass.
      comments: ["A criterion is still unmet after the fix pass.\n\n<!-- fix-pass:v1 -->"],
      children: [341],
    });

    expect(commentsCarrying(fake, "prd-check:v1").length).toBeGreaterThan(0);
    expect(fake.labelsRemoved).toEqual([]);
  });
});

/**
 * The dispatch actions are each spelled twice — once in `reconcile.ts` and once in the workflow
 * that runs it. No compiler sees across that language boundary, so a test does, the same way
 * `capture/dispatch-action.test.ts` pins every consumer of the capture dispatch.
 */
describe("dispatch-reconcile.yml agrees with the entrypoint it runs", () => {
  const { workflow, source } = readWorkflow<{
    on: Record<string, unknown>;
    concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    jobs: Record<string, { if?: string }>;
  }>("dispatch-reconcile.yml");

  it("triggers on repository_dispatch", () => {
    expect(workflow.on).toHaveProperty("repository_dispatch");
  });

  it("gates the job on both actions the entrypoint answers, and no others", () => {
    const jobIf = workflow.jobs.reconcile.if ?? "";

    for (const action of RECONCILE_DISPATCH_ACTIONS) {
      expect(jobIf).toContain(`github.event.action == '${action}'`);
    }
    expect(RECONCILE_DISPATCH_ACTIONS).toEqual([
      SESSION_CAPTURED_DISPATCH_ACTION,
      GRAPH_CHANGED_DISPATCH_ACTION,
    ]);
    // Two dispatch conditions and the manual one, so a third action cannot be added to the workflow
    // without the entrypoint learning about it.
    expect(jobIf.match(/github\.event\.action ==/g)).toHaveLength(RECONCILE_DISPATCH_ACTIONS.length);
  });

  it("can send a repository_dispatch, which needs contents: write and not merely read", () => {
    // `POST /repos/{owner}/{repo}/dispatches` is a contents write. A `contents: read` block replaces
    // the default token rather than adding to it, so the one call that matters would 403 while the
    // run reported `clear`.
    expect(source).toMatch(/^ {2}contents: write$/m);
    expect(source).toMatch(/^ {2}issues: write$/m);
  });

  it("runs the reconciler and installs no model CLI — this spends nothing", () => {
    expect(source).toContain("dispatch/reconcile.ts");
    expect(source).not.toContain("@anthropic-ai/claude-code");
    expect(source).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("serialises rather than cancels, so a recompute is never half-run", () => {
    expect(workflow.concurrency?.group).toBeTruthy();
    expect(workflow.concurrency?.group).not.toMatch(/\$\{\{/);
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });
});

describe("the wave this lane sends", () => {
  it("is the same action implement.yml gates on", () => {
    const { workflow } = readWorkflow<{ jobs: { implement: { if: string } } }>("implement.yml");
    expect(workflow.jobs.implement.if).toContain(`github.event.action == '${TICKET_READY_DISPATCH_ACTION}'`);
  });
});
