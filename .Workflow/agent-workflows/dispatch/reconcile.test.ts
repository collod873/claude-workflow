import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CloseTicketResult } from "../shared/close-ticket";
import { expectMachineAndTargetCheckouts } from "../shared/checkout-pair.fixture";
import type { GhExec } from "../shared/gh";
import { issueCommentPathMatcher, issueCommentsPathMatcher, matchingRefsPath, subIssuesPathMatcher } from "../shared/gh-paths";
import { readWorkflow } from "../shared/read-workflow";
import { GRAPH_CHANGED_DISPATCH_ACTION, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import { FINDING_MARKER, retirementBody } from "../watchdog/unreachable";

const closeTicketProcessCalls: (readonly string[])[] = [];
vi.mock("../shared/close-ticket", () => ({
  closeTicketProcess: (args: readonly string[]) => {
    closeTicketProcessCalls.push(args);
    return { exitCode: 0, output: "" };
  },
}));

const {
  closedByMergedPr,
  deliveryOf,
  RECONCILE_DISPATCH_ACTIONS,
  runReconcile,
  runRealSpecClose,
  SESSION_CAPTURED_DISPATCH_ACTION,
  TO_BUILD_LABEL,
} = await import("./reconcile");

/** A published slice's body — `render-body.ts` writes this heading and nothing else does. */
function sliceBody(prd = 145): string {
  return `## Parent PRD\n#${prd}\n\n## What to build\nSomething.\n`;
}

/**
 * A ticket the owner wrote in a session: both headings lane 06 needs and no `## Parent PRD`
 * anywhere on it, which is the whole point — the second door admits work no slicer ever produced.
 */
const HAND_WRITTEN_TICKET = [
  "## What to build",
  "",
  "Something the owner could already write in full.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] `bin/gauntlet push` exits 0 — check: `bin/gauntlet push`",
  "",
  "## Files claimed",
  "",
  "- None — no files.",
  "",
].join("\n");

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
  /** When the closing PR merged — the spec-closing pass's own "branch position" ordering. */
  mergedAt?: string;
  /** The closing PR's own merge commit — what the spec-closing pass's synthesized range names. */
  mergeSha?: string;
}

/**
 * The pull request the fake says closed issue `n`, and the inverse. An issue and its closer are
 * different numbers in the real tracker — #237 was closed by PR #244 — so the fake gives them
 * different numbers too, and a reader that confused the two would fail here rather than pass by
 * coincidence.
 */
const closingPrFor = (issue: number) => issue * 10 + 4;
const closerOwner = (pr: number) => (pr - 4) / 10;

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

  /**
   * How this fake reports a related issue: its number and its state, resolved off the one
   * `closed`/`open` bookkeeping every handler here shares. Both edge endpoints answer in this
   * shape — blocked-by edges and sub-issues — and the reconciler reads `state`/`state_reason` from
   * each, so they are answered by one function rather than two that can drift apart.
   */
  const issueRefs = (numbers: number[]): string =>
    JSON.stringify(
      numbers.map((number) => {
        const record = closed.get(number);
        return record
          ? { number, state: "closed", state_reason: record.stateReason }
          : { number, state: "open", state_reason: null };
      }),
    );

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

    // The two calls the delivery question actually takes, answered the way GitHub answers them.
    // This branch used to return `["MERGED"]` — a state served straight off the issue — and that
    // fiction is the whole reason the reader shipped asking for a field that does not exist
    // (ADR-0106). `closedByPullRequestsReferences` carries a PR's *number*; only the pull request
    // itself knows whether it merged, so the fake makes the reader go and ask.
    if (args[0] === "issue" && args[1] === "view") {
      const record = closed.get(Number(args[2]));
      return JSON.stringify(record ? [closingPrFor(record.number)] : []);
    }

    if (args[0] === "pr" && args[1] === "view") {
      const record = closed.get(closerOwner(Number(args[2])));
      if (args.includes("--jq")) return `${record?.merged ? "MERGED" : "CLOSED"}\n`;
      // `--json mergedAt,mergeCommit`, no `--jq` — the spec-closing pass's own "branch position"
      // read, asked only of a PR the two-call delivery question above already found merged.
      return JSON.stringify({
        mergedAt: record?.merged ? record.mergedAt ?? null : null,
        mergeCommit: record?.merged && record.mergeSha ? { oid: record.mergeSha } : null,
      });
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
        return issueRefs(open.get(Number(edges[1]))?.blockedBy ?? []);
      }

      const subIssues = subIssuesPathMatcher.exec(path);
      if (subIssues) {
        // `{number}` is all `fetchSubIssueCount` asks for; the spec-closing pass's own
        // `fetchChildren` reads `state`/`state_reason` off the same endpoint, so both are served
        // the same way.
        return issueRefs(open.get(Number(subIssues[1]))?.children ?? []);
      }
    }

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, dispatches, comments, created, closedByRun, commentEdits, labelsAdded, labelsRemoved };
}

const silent = () => {};

/** A runnable spec body: one criterion, one well-formed `check:` marker. Shared by the spec-evaluate and spec-closing describes below. */
const RUNNABLE_BODY = [
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
  "",
].join("\n");

/**
 * One reconcile pass over a tracker holding exactly one open issue, returning the fake for the
 * assertions. Every case in the spec-evaluate block differs only in the issue it starts from, so
 * the pass itself is written once.
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

/**
 * The delivery question, replayed against payloads recorded from the live tracker rather than
 * against a shape this file made up — `gh issue view 237 --json closedByPullRequestsReferences` and
 * `gh pr view 244 --json state`, both captured on 2026-08-29.
 *
 * This is the guard the old reader never had — `closedByMergedPr`'s docstring in `reconcile.ts` is
 * the home for the defect it exists to catch (ADR-0106). A fixture cannot be talked into agreeing
 * the way the hand-written fake that missed it could.
 *
 * `applyJq` is deliberately tiny and deliberately fed the reader's *own* `--jq` string: the point is
 * that the expression the code ships is the expression the recorded data is read with, so putting
 * `.state` back reproduces the `[null]` that started this.
 */
describe("the delivery question, against payloads GitHub actually served", () => {
  const fixture = (name: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, "closing-prs.fixtures", name), "utf8"));

  const CLOSED_BY = fixture("issue-237-closed-by.json");
  const PR_STATE = fixture("pr-244-state.json");

  /** `[.a[].b]` and `.a`, the only two forms the reader sends. Strings print raw, as `gh --jq` does. */
  function applyJq(expression: string, payload: unknown): string {
    const collect = /^\[\.([A-Za-z]+)\[\]\.([A-Za-z_]+)\]$/.exec(expression);
    if (collect) {
      const nodes = (payload as Record<string, Record<string, unknown>[]>)[collect[1]] ?? [];
      return JSON.stringify(nodes.map((node) => node[collect[2]] ?? null));
    }
    const field = /^\.([A-Za-z]+)$/.exec(expression)![1];
    return String((payload as Record<string, unknown>)[field]);
  }

  const replay: GhExec = (args) => {
    const expression = args[args.indexOf("--jq") + 1];
    return applyJq(expression, args[0] === "issue" ? CLOSED_BY : PR_STATE);
  };

  it("carries the closing pull request's number, and no state anywhere on it", () => {
    const [node] = CLOSED_BY.closedByPullRequestsReferences;
    expect(node.number).toBe(244);
    expect(node).not.toHaveProperty("state");
  });

  it("reads #237 as delivered, which is what it is: merged as PR #244", () => {
    expect(closedByMergedPr(replay, 237)).toBe(true);
  });

  it("asks the pull request for the state, never the issue", () => {
    const asked: string[][] = [];
    const watched: GhExec = (args) => {
      asked.push([...args]);
      return replay(args);
    };
    closedByMergedPr(watched, 237);
    expect(asked[0].slice(0, 2)).toEqual(["issue", "view"]);
    expect(asked[1].slice(0, 3)).toEqual(["pr", "view", "244"]);
  });
});

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
   * The scope rule, and it is a safety rule. Being in the graph is what makes an issue ready;
   * being something the owner meant to be built is what makes it something an implementer may be
   * pointed at. Without this, every unblocked issue on the tracker — this ticket included — would
   * get a Sonnet run and a pull request.
   *
   * #184 widened the rule to a second door and did not weaken it: an issue carrying neither the
   * `## Parent PRD` heading nor `to-build` is still refused however ready it looks, which is what
   * this pins.
   */
  it("never dispatches an issue that is neither a published slice nor labelled to-build", () => {
    const fake = createFake({
      open: [
        {
          number: 30,
          title: "A hand-written idea",
          // Ticket-shaped, and still not dispatched: shape was never the missing term.
          body: HAND_WRITTEN_TICKET,
          labels: [],
        },
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

/**
 * Lane 06's second door (#184). Everything downstream of the dispatch is unchanged, so what is
 * worth pinning here is the door itself: what it admits, what it still refuses, and that it enters
 * the recompute rather than firing once at label time.
 */
describe("the to-build door into lane 06 (#184)", () => {
  /** The issue the owner labelled, with whatever body and blockers the case is about. */
  const labelled = (number: number, body = HAND_WRITTEN_TICKET, blockedBy?: number[]): FakeIssue => ({
    number,
    title: "A ticket the owner wrote in full",
    body,
    labels: [TO_BUILD_LABEL],
    blockedBy,
  });

  it("dispatches a labelled ticket carrying no ## Parent PRD heading at all", () => {
    const fake = createFake({ open: [labelled(600)] });

    const outcome = runReconcile({ gh: fake.gh, log: silent });

    expect(fake.dispatches).toEqual([600]);
    expect(outcome.action).toBe("dispatched");
  });

  /**
   * The reason this rides the reconciler rather than dispatching at label time. A one-shot send
   * would start a blocked ticket immediately, or never start it once its blockers cleared — #179
   * rebuilt inside the new door. Both halves are one case because the second is only meaningful as
   * the sequel to the first.
   */
  it("holds a labelled ticket behind an open blocker, and starts it on the recompute after that blocker delivers", () => {
    const blocked = createFake({
      open: [{ number: 11, title: "Still building" }, labelled(610, HAND_WRITTEN_TICKET, [11])],
    });
    runReconcile({ gh: blocked.gh, log: silent });
    expect(blocked.dispatches).not.toContain(610);

    const cleared = createFake({
      open: [labelled(610, HAND_WRITTEN_TICKET, [11])],
      closed: [{ number: 11, stateReason: "completed", merged: true }],
    });
    runReconcile({ gh: cleared.gh, log: silent });

    expect(cleared.dispatches).toEqual([610]);
  });

  it("does not dispatch a labelled ticket twice — the implement/issue-<n> ref is still the claim", () => {
    const fake = createFake({ open: [labelled(620)], claimed: ["implement/issue-620"] });

    const outcome = runReconcile({ gh: fake.gh, log: silent });

    expect(fake.dispatches).toEqual([]);
    expect(outcome.action).toBe("clear");
  });

  /**
   * W1, refuse at the moment of the act. Verify's Immutability job reads the same `## Files
   * claimed` section, so without this a label on a malformed body spends an implementer and a pull
   * request to reach the same verdict.
   */
  it.each([
    {
      what: "no ## Acceptance criteria heading",
      body: "## What to build\n\nSomething.\n\n## Files claimed\n\n- None — no files.\n",
      names: "Acceptance criteria",
    },
    {
      what: "no ## Files claimed heading",
      body: "## Acceptance criteria\n\n- [ ] It works — check: `true`\n",
      names: "Files claimed",
    },
  ])("refuses a labelled ticket with $what, dispatching nothing and saying what is missing", ({ body, names }) => {
    const fake = createFake({ open: [labelled(630, body)] });

    runReconcile({ gh: fake.gh, log: silent });

    expect(fake.dispatches).toEqual([]);
    expect(fake.comments).toHaveLength(1);
    expect(fake.comments[0].issue).toBe(630);
    expect(fake.comments[0].body).toContain(names);
    expect(fake.comments[0].body).toContain("to-build-refused:v1");
  });

  /**
   * The reconciler re-runs on every session end and the label is never removed, so a refusal that
   * filed per run would be the unbounded touch ADR-0064 rules against. The second pass here is
   * given the comment the first one actually wrote, rather than a hand-typed guess at it.
   */
  it("says it once — a second recompute over the same state writes nothing further", () => {
    const malformed = "## Acceptance criteria\n\n- [ ] It works — check: `true`\n";
    const first = createFake({ open: [labelled(640, malformed)] });
    runReconcile({ gh: first.gh, log: silent });

    const second = createFake({
      open: [{ ...labelled(640, malformed), comments: [first.comments[0].body] }],
    });
    runReconcile({ gh: second.gh, log: silent });

    expect(second.comments).toEqual([]);
    expect(second.commentEdits).toEqual([]);
  });

  it("rewrites its standing refusal, and drops the marker, once the body validates and the ticket starts", () => {
    const stale = createFake({
      open: [
        {
          ...labelled(650),
          comments: ["Missing something.\n\n<!-- to-build-refused:v1 -->"],
        },
      ],
    });

    runReconcile({ gh: stale.gh, log: silent });

    expect(stale.dispatches).toEqual([650]);
    expect(stale.commentEdits).toHaveLength(1);
    expect(stale.commentEdits[0].body).not.toContain("to-build-refused:v1");
  });

  it("writes nothing at all to an issue it neither refuses nor has anything standing on", () => {
    const fake = createFake({ open: [labelled(660)] });

    runReconcile({ gh: fake.gh, log: silent });

    expect(fake.comments).toEqual([]);
    expect(fake.commentEdits).toEqual([]);
  });

  it("refuses and comments on nothing in a dry run", () => {
    const fake = createFake({
      open: [labelled(670, "## Acceptance criteria\n\n- [ ] It works — check: `true`\n")],
    });

    runReconcile({ gh: fake.gh, log: silent, dryRun: true });

    expect(fake.comments).toEqual([]);
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
  const UNRUNNABLE_BODY = [
    "## Acceptance criteria",
    "",
    "- [ ] I'll know it works when I can see a verdict — check: `true`",
    "- [ ] And also when I can see the second thing — check: `true`",
    "",
  ].join("\n");

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

  /**
   * `runCheckCommand` used to spawn a criterion's `check:` command with no `cwd` at all, which
   * defaults to `process.cwd()` — this process's own machine checkout, not the target the spec
   * describes. `pwd` names the directory a shell command actually ran in, so a verdict comment
   * that echoes it back is direct evidence of which checkout the check saw.
   */
  it("runs a spec's own check: command against targetWorkspace, not this process's own cwd", () => {
    const targetWorkspace = realpathSync(mkdtempSync(join(tmpdir(), "reconcile-target-")));
    const body = ["## Acceptance criteria", "", "- [ ] It works — check: `pwd`", ""].join("\n");
    const fake = createFake({
      open: [{ number: 350, title: "A spec", body, labels: ["prd"], children: [351] }],
    });

    runReconcile({ gh: fake.gh, log: silent, targetWorkspace });

    const verdicts = commentsCarrying(fake, "prd-check:v1");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toContain(targetWorkspace);
  });
});

/**
 * `runRealSpecClose`'s third positional is `bin/close-ticket`'s own `<checkout>` argument. It used
 * to be a bare `"."`, which `closeTicketProcess` — carrying no `cwd` of its own — resolved against
 * this process's own `process.cwd()`: the machine checkout, not the target the spec describes.
 */
describe("runRealSpecClose", () => {
  it("names the target checkout as bin/close-ticket's own <checkout> argument, never a bare '.'", () => {
    closeTicketProcessCalls.length = 0;

    runRealSpecClose(500, "aaa^..bbb", "/some/target/checkout");

    expect(closeTicketProcessCalls).toEqual([["--spec", "500", "aaa^..bbb", "/some/target/checkout"]]);
  });
});

/**
 * Lane 09's spec-closing pass (#233): once a spec's own check reads green, its own
 * `bin/close-ticket --spec` — injected here the way `integrate.test.ts` injects `closeTicket` —
 * runs against a range synthesized from its children's own delivering merges, and never runs at
 * all with an undelivered child.
 */
describe("runReconcile's spec-closing pass (#233)", () => {
  interface CloseCall {
    number: number;
    range: string;
  }

  /** Records every `closeSpec` invocation, in call order, and hands back the canned `result` for each. */
  function fakeCloser(result: CloseTicketResult): {
    closeSpec: (number: number, range: string) => CloseTicketResult;
    calls: CloseCall[];
  } {
    const calls: CloseCall[] = [];
    return {
      calls,
      closeSpec: (number, range) => {
        calls.push({ number, range });
        return result;
      },
    };
  }

  /** A child closed as completed by a merged pull request — the estate's `delivered`. */
  function delivered(number: number, mergedAt: string, mergeSha: string): FakeClosed {
    return { number, stateReason: "completed", merged: true, mergedAt, mergeSha };
  }

  /** A runnable spec carrying `children`, which is the only thing that differs between these cases. */
  function spec(number: number, children: number[], body: string = RUNNABLE_BODY) {
    return { number, title: "A spec", body, labels: ["prd"], children };
  }

  /**
   * Builds the tracker `setup` describes, runs the pass over it, and hands back every closer
   * invocation. Arranging a fake, injecting a recording closer and running the pass is the same
   * three lines in every case below — so each case spells out only the tracker it starts from,
   * which is the thing it is actually about.
   */
  function runClosingPass(setup: FakeOptions, result: CloseTicketResult = { exitCode: 0, output: "" }): CloseCall[] {
    const fake = createFake(setup);
    const closer = fakeCloser(result);
    runReconcile({ gh: fake.gh, log: silent, closeSpec: closer.closeSpec });
    return closer.calls;
  }

  /** A spec whose own criterion cannot check out — `false` never exits 0. */
  const UNMET_BODY = [
    "## Acceptance criteria",
    "",
    "- [ ] I'll know it works when I can see a verdict on the spec — check: `false`",
    "",
  ].join("\n");

  it("invokes bin/close-ticket --spec once its own check reads green and every child is delivered", () => {
    const calls = runClosingPass(
      {
        open: [spec(400, [401, 402])],
        closed: [delivered(401, "2026-01-01T00:00:00Z", "aaa111"), delivered(402, "2026-01-02T00:00:00Z", "bbb222")],
      },
      { exitCode: 0, output: "## Closing record\n\n..." },
    );

    expect(calls).toEqual([{ number: 400, range: "aaa111^..bbb222" }]);
  });

  /**
   * Every way a spec can fail to be closeable. The act and the assertion are identical across all
   * of them — the closer is never reached — so the tracker each starts from is the whole of the
   * case, and a table says that more plainly than five near-identical bodies do.
   */
  it.each([
    { why: "a child is still open", setup: { open: [spec(420, [421])] } },
    {
      why: "a child was closed as not planned",
      setup: { open: [spec(430, [431])], closed: [{ number: 431, stateReason: "not_planned" as const }] },
    },
    {
      why: "a child was closed by hand rather than by a merged pull request",
      setup: { open: [spec(440, [441])], closed: [{ number: 441, stateReason: "completed" as const }] },
    },
    {
      // #447 carries no `closed` record at all — still open.
      why: "one child among several is undelivered",
      setup: { open: [spec(445, [446, 447])], closed: [delivered(446, "2026-01-01T00:00:00Z", "x")] },
    },
    {
      why: "the spec's own check does not read green, whatever the children's delivery",
      setup: { open: [spec(490, [491], UNMET_BODY)], closed: [delivered(491, "2026-01-01T00:00:00Z", "y")] },
    },
  ])("never invokes the closer when $why", ({ setup }) => {
    expect(runClosingPass(setup)).toEqual([]);
  });

  /**
   * The range is `<first merge>^..<last merge>` by **branch position** — where the delivering
   * commits sit, not what the child issues are numbered. Each row varies only the merges, which is
   * exactly the variable the rule is about.
   */
  it.each([
    {
      what: "orders the range by when each delivering pull request merged, not by the child issue's own number",
      // #460 carries the higher issue number but merged first — the range must still start there.
      setup: {
        open: [spec(450, [452, 460])],
        closed: [delivered(460, "2026-01-01T00:00:00Z", "early111"), delivered(452, "2026-01-02T00:00:00Z", "late222")],
      },
      expected: { number: 450, range: "early111^..late222" },
    },
    {
      what: "collapses a single delivering child to <merge>^..<merge>",
      setup: { open: [spec(470, [471])], closed: [delivered(471, "2026-01-01T00:00:00Z", "solo333")] },
      expected: { number: 470, range: "solo333^..solo333" },
    },
  ])("$what", ({ setup, expected }) => {
    expect(runClosingPass(setup)).toEqual([expected]);
  });

  it("rewrites the verdict naming both exit codes on a pass/closer disagreement, leaves the spec open, and writes no needs-human", () => {
    const fake = createFake({
      open: [spec(480, [481])],
      closed: [delivered(481, "2026-01-01T00:00:00Z", "sha444")],
    });

    runReconcile({
      gh: fake.gh,
      log: silent,
      closeSpec: () => ({ exitCode: 1, output: "error: #481 is not delivered enough after all" }),
    });

    const verdicts = commentsCarrying(fake, "prd-check:v1");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toContain("exit 0");
    expect(verdicts[0]).toContain("bin/close-ticket --spec");
    expect(verdicts[0]).toContain("exit 1");
    expect(verdicts[0]).toContain("error: #481 is not delivered enough after all");

    expect(fake.labelsAdded.map((entry) => entry.name)).not.toContain("needs-human");
    expect(fake.closedByRun).toEqual([]);
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
    jobs: Record<string, { if?: string; env?: Record<string, string> }>;
  }>("dispatch-reconcile.yml");

  // #314, ADR-0055 (amended by ADR-0132): the trigger moved to the caller stub, since a reusable
  // workflow's own `on:` is `workflow_call` — see the block below.
  it("is reusable — a caller supplies the trigger", () => {
    expect(workflow.on).toHaveProperty("workflow_call");
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

  it("admits the labelled event only for to-build, and only from the repository owner", () => {
    const jobIf = workflow.jobs.reconcile.if ?? "";

    expect(jobIf).toContain("github.event_name == 'issues'");
    expect(jobIf).toContain(`github.event.label.name == '${TO_BUILD_LABEL}'`);
    // The same sender gate `spec.yml` and `shape.yml` carry: this repository is public, so a label
    // can arrive from anyone where a `repository_dispatch` cannot.
    expect(jobIf).toContain("github.event.sender.login == github.repository_owner");
  });

  /**
   * `main()` refuses any `EVENT_ACTION` outside `RECONCILE_DISPATCH_ACTIONS`, and the label event's
   * own `github.event.action` is `labeled` — so the run would die at the entrypoint on the very
   * trigger #184 added. The env is a GitHub expression, so this is as close as a test gets to
   * evaluating it: the only branch that forwards an event's own action is guarded on
   * `repository_dispatch`, and everything else falls through to a literal the entrypoint answers.
   */
  it("hands the entrypoint an action it answers on a trigger that carries none of its own", () => {
    const expression = workflow.jobs.reconcile.env?.EVENT_ACTION ?? "";

    expect(expression).toMatch(/github\.event_name == 'repository_dispatch' && github\.event\.action/);
    const fallback = /\|\|\s*'([^']+)'/.exec(expression)?.[1];
    expect(RECONCILE_DISPATCH_ACTIONS).toContain(fallback);
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

  it("separates the machine it runs from the target a spec's own check runs against", () => {
    // Without TARGET_WORKSPACE on this step, reconcile.ts falls back to process.cwd() and runs a
    // spec's check: command, and bin/close-ticket --spec's own <checkout> argument, against the
    // machine checkout instead of the target's.
    expectMachineAndTargetCheckouts({ workflow: "dispatch-reconcile.yml", job: "reconcile", runs: "reconcile.ts" });
  });

  it("serialises rather than cancels, so a recompute is never half-run", () => {
    expect(workflow.concurrency?.group).toBeTruthy();
    expect(workflow.concurrency?.group).not.toMatch(/\$\{\{/);
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });
});

describe("dispatch-reconcile-caller.yml gates the reusable workflow", () => {
  const { workflow, source } = readWorkflow<{
    on: {
      repository_dispatch?: { types?: string[] };
      issues?: { types?: string[] };
      workflow_dispatch?: unknown;
    };
    jobs: { reconcile: { uses?: string } };
  }>("dispatch-reconcile-caller.yml");

  it("fires on both dispatch actions and a manual run", () => {
    expect(workflow.on.repository_dispatch?.types?.slice().sort()).toEqual(
      [...RECONCILE_DISPATCH_ACTIONS].sort(),
    );
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  /**
   * #184's door. The trigger lives on the stub rather than beside the job it starts because a
   * reusable workflow's own `on:` is `workflow_call` and nothing else (ADR-0055, amended by
   * ADR-0132); `dispatch-reconcile.yml`'s job `if` is where the `to-build` and sender conditions
   * are, reading this caller's event.
   */
  it("fires on a label, so the to-build door reaches the recompute", () => {
    expect(workflow.on.issues?.types).toEqual(["labeled"]);
  });

  it("calls the reusable workflow at @main, never a pinned SHA or tag", () => {
    expect(workflow.jobs.reconcile.uses).toBe(
      "collod873/claude-workflow/.github/workflows/dispatch-reconcile.yml@main",
    );
  });

  it("carries no secret — this reconciler spends nothing", () => {
    expect(source).not.toMatch(/secrets:/);
  });
});

describe("the wave this lane sends", () => {
  it("is the same action implement.yml gates on", () => {
    const { workflow } = readWorkflow<{ jobs: { implement: { if: string } } }>("implement.yml");
    expect(workflow.jobs.implement.if).toContain(`github.event.action == '${TICKET_READY_DISPATCH_ACTION}'`);
  });
});
