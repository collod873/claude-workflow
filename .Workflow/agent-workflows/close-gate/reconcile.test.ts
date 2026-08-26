import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { workflowPathMatcher, workflowRunsPathMatcher } from "../shared/gh-paths";
import {
  GATE_WORKFLOW_FILE,
  RECONCILE_DISPATCH_ACTION,
  RUN_PAGE_SIZE,
  reconcile,
  runReconcile,
  type ClosedIssue,
  type GateRun,
} from "./reconcile";

const silent = () => {};

/**
 * The reconciler's half of the API, faked inline rather than in a
 * `.fake.ts` of its own.
 *
 * `tracker.fake.ts` models the gate's half — `issue view`, `reopen`,
 * `edit`, `comment` — and this half is disjoint from it again: a search
 * over closed issues and a workflow-runs read. It lives here because this
 * is the only file that makes those calls; the moment a second one does,
 * it earns a module the way the other two did.
 */
interface FakeRuns {
  gh: GhExec;
  calls: string[][];
  reopened: Array<{ number: number; comment: string }>;
}

interface FakeRunsOptions {
  issues?: ClosedIssue[];
  runs?: GateRun[];
  /** When the gate workflow itself first existed. */
  gateStart?: string;
  issueListFails?: boolean;
  runsFail?: boolean;
  gateStartFails?: boolean;
  reopenFailsFor?: number[];
}

/** Before every close any test writes, unless a test says otherwise. */
const GATE_EXISTED_SINCE = "2026-08-01T00:00:00Z";

function createFakeRuns(options: FakeRunsOptions = {}): FakeRuns {
  const calls: string[][] = [];
  const reopened: Array<{ number: number; comment: string }> = [];

  const gh: GhExec = (args) => {
    calls.push(args);

    if (args[0] === "issue" && args[1] === "list") {
      if (options.issueListFails) {
        throw new Error("fake: gh issue list refused");
      }
      return JSON.stringify(options.issues ?? []);
    }

    if (args[0] === "api" && workflowRunsPathMatcher.test((args[1] ?? "").split("?")[0])) {
      if (options.runsFail) {
        throw new Error("fake: the Actions API refused");
      }
      return JSON.stringify({ workflow_runs: options.runs ?? [] });
    }

    if (args[0] === "api" && workflowPathMatcher.test(args[1] ?? "")) {
      if (options.gateStartFails) {
        throw new Error("fake: the Actions API refused");
      }
      return JSON.stringify({ created_at: options.gateStart ?? GATE_EXISTED_SINCE });
    }

    if (args[0] === "issue" && args[1] === "reopen") {
      const number = Number(args[2]);
      if ((options.reopenFailsFor ?? []).includes(number)) {
        throw new Error("fake: reopen refused");
      }
      const commentFlag = args.indexOf("--comment");
      reopened.push({ number, comment: commentFlag === -1 ? "" : args[commentFlag + 1] });
      return "";
    }

    throw new Error(`fake runs: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, reopened };
}

const NOW = new Date("2026-08-26T20:00:00Z");

function closed(
  number: number,
  closedAt: string,
  title = `issue ${number}`,
  stateReason = "COMPLETED",
): ClosedIssue {
  return { number, title, closedAt, stateReason };
}

function run(
  createdAt: string,
  title: string,
  status = "completed",
  conclusion: string | null = "success",
): GateRun {
  return {
    created_at: createdAt,
    display_title: title,
    status,
    conclusion,
    html_url: "https://github.com/o/r/actions/runs/1",
  };
}

describe("pairing a close with the run that judged it", () => {
  it("pairs a run created just after the close", () => {
    const verdicts = reconcile(
      [closed(1, "2026-08-26T12:00:00Z")],
      [run("2026-08-26T12:00:03Z", "issue 1")],
    );
    expect(verdicts[0]).toMatchObject({ state: "judged", delaySeconds: 3 });
  });

  it("pairs a run the outage delayed by nineteen minutes", () => {
    // #103's real shape on 2026-08-26: the event was throttled, not
    // dropped, and reopening it would have fought a run that was coming.
    const verdicts = reconcile(
      [closed(103, "2026-08-26T15:46:25Z")],
      [run("2026-08-26T16:05:13Z", "issue 103")],
    );
    expect(verdicts[0]).toMatchObject({ state: "judged", delaySeconds: 1128 });
  });

  it("calls a close with no run at all unjudged", () => {
    const verdicts = reconcile([closed(1, "2026-08-26T12:00:00Z")], []);
    expect(verdicts[0]).toMatchObject({ state: "unjudged", run: null });
  });

  it("does not let a run created before the close answer for it", () => {
    const verdicts = reconcile(
      [closed(1, "2026-08-26T12:00:00Z")],
      [run("2026-08-26T11:00:00Z", "issue 1")],
    );
    expect(verdicts[0].state).toBe("unjudged");
  });

  it("allows a minute of clock slack between the two APIs", () => {
    const verdicts = reconcile(
      [closed(1, "2026-08-26T12:00:00Z")],
      [run("2026-08-26T11:59:50Z", "issue 1")],
    );
    expect(verdicts[0].state).toBe("judged");
  });

  it("lets one run answer for only one close, so a shared title cannot vouch twice", () => {
    const verdicts = reconcile(
      [closed(1, "2026-08-26T12:00:00Z", "same title"), closed(2, "2026-08-26T12:05:00Z", "same title")],
      [run("2026-08-26T12:05:02Z", "same title")],
    );
    // The run is consumed by the older close it could belong to; the
    // younger one is reported unjudged rather than silently covered.
    expect(verdicts.map((verdict) => verdict.state)).toEqual(["judged", "unjudged"]);
  });
});

describe("a run that exists but rendered no verdict", () => {
  it("leaves a queued run alone — it may still judge the close", () => {
    // #85's real shape: created 219s after the close and still queued two
    // hours later. Reopening it would fight a run that is coming.
    const verdicts = reconcile(
      [closed(85, "2026-08-26T15:13:38Z")],
      [run("2026-08-26T15:17:17Z", "issue 85", "queued", null)],
    );
    expect(verdicts[0].state).toBe("pending");
  });

  it("counts a failed run as judged — a degraded gate already reopened the issue", () => {
    const verdicts = reconcile(
      [closed(1, "2026-08-26T12:00:00Z")],
      [run("2026-08-26T12:00:02Z", "issue 1", "completed", "failure")],
    );
    expect(verdicts[0].state).toBe("judged");
  });

  it.each(["cancelled", "skipped", "timed_out", "stale"])(
    "counts a %s run as unjudged — the close was never read",
    (conclusion) => {
      const verdicts = reconcile(
        [closed(1, "2026-08-26T12:00:00Z")],
        [run("2026-08-26T12:00:02Z", "issue 1", "completed", conclusion)],
      );
      expect(verdicts[0].state).toBe("unjudged");
    },
  );
});

describe("scope — which closes are reconciled at all", () => {
  it("ignores a close marked not planned, which claims no delivery", () => {
    const verdicts = reconcile([closed(1, "2026-08-26T12:00:00Z", "t", "NOT_PLANNED")], []);
    expect(verdicts).toEqual([]);
  });

  it("ignores a close whose reason the tracker did not carry", () => {
    const verdicts = reconcile([{ number: 1, title: "t", closedAt: "2026-08-26T12:00:00Z" }], []);
    expect(verdicts).toEqual([]);
  });
});

describe("what it does about what it finds", () => {
  it("reopens an unjudged close with a comment naming why no verdict exists", () => {
    const fake = createFakeRuns({ issues: [closed(7, "2026-08-26T15:46:00Z")], runs: [] });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome).toMatchObject({ action: "reopened", reopened: [7] });
    expect(fake.reopened).toHaveLength(1);
    expect(fake.reopened[0].comment).toContain("never judged");
    expect(fake.reopened[0].comment).toContain("no `Close gate` run was ever created");
  });

  it("applies no label — an unjudged close is not a refused one (ADR-0023)", () => {
    const fake = createFakeRuns({ issues: [closed(7, "2026-08-26T15:46:00Z")], runs: [] });
    runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(fake.calls.filter((args) => args.includes("--add-label"))).toEqual([]);
  });

  it("writes nothing when every close in the window was judged", () => {
    const fake = createFakeRuns({
      issues: [closed(1, "2026-08-26T12:00:00Z")],
      runs: [run("2026-08-26T12:00:03Z", "issue 1")],
    });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome).toMatchObject({ action: "clear", checked: 1, reopened: [] });
    expect(fake.reopened).toEqual([]);
  });

  it("reports a still-queued run rather than reopening under it", () => {
    const fake = createFakeRuns({
      issues: [closed(85, "2026-08-26T15:13:38Z")],
      runs: [run("2026-08-26T15:17:17Z", "issue 85", "queued", null)],
    });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome).toMatchObject({ action: "clear", pending: [85] });
    expect(fake.reopened).toEqual([]);
  });

  it("does not let one issue that will not reopen cost the others theirs", () => {
    const fake = createFakeRuns({
      issues: [closed(7, "2026-08-26T15:00:00Z"), closed(8, "2026-08-26T15:30:00Z")],
      runs: [],
      reopenFailsFor: [7],
    });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome.reopened).toEqual([8]);
  });

  it("ignores a close older than the lookback window", () => {
    const fake = createFakeRuns({
      issues: [closed(1, "2026-08-01T12:00:00Z")],
      runs: [run("2026-08-19T00:00:00Z", "unrelated")],
    });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome).toMatchObject({ action: "clear", checked: 0 });
  });
});

describe("the window it is honest about", () => {
  it("does not reach back past the gate's own first day", () => {
    // The first dry run of this module over a real seven-day window found
    // 42 "unjudged" closes, every one from before the gate shipped. A close
    // a non-existent workflow did not judge is history, not outstanding
    // work — and the lookback window alone does not encode that.
    const lines: string[] = [];
    const fake = createFakeRuns({
      issues: [closed(1, "2026-08-22T12:00:00Z")],
      runs: [],
      gateStart: "2026-08-25T23:35:52Z",
    });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: (line) => lines.push(line) });

    expect(outcome).toMatchObject({ action: "clear", checked: 0 });
    expect(fake.reopened).toEqual([]);
    expect(lines.join("\n")).toContain("did not exist before then");
  });

  it("still judges a close that landed after the gate shipped", () => {
    const fake = createFakeRuns({
      issues: [closed(1, "2026-08-26T00:11:48Z")],
      runs: [],
      gateStart: "2026-08-25T23:35:52Z",
    });
    expect(runReconcile({ now: NOW, gh: fake.gh, log: silent }).reopened).toEqual([1]);
  });

  it("does not clip when the page is short — a short page has seen every run there is", () => {
    // The only reason a close can be older than every run on the page and
    // still be answerable: there are no more runs to fetch.
    const fake = createFakeRuns({
      issues: [closed(1, "2026-08-21T12:00:00Z")],
      runs: [run("2026-08-25T00:00:00Z", "something else")],
    });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome).toMatchObject({ action: "reopened", reopened: [1] });
  });

  it("clips to what one full page of runs reaches, and says so", () => {
    // A full page is the one case where a run may exist and be invisible —
    // the API returns the newest first. Reopening below the page's floor
    // would be filing work against the reconciler's own page size.
    const lines: string[] = [];
    const fake = createFakeRuns({
      issues: [closed(1, "2026-08-21T12:00:00Z")],
      runs: Array.from({ length: RUN_PAGE_SIZE }, (_unused, index) =>
        run(new Date(Date.parse("2026-08-25T00:00:00Z") + index * 60_000).toISOString(), "other"),
      ),
    });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: (line) => lines.push(line) });

    expect(outcome).toMatchObject({ action: "clear", checked: 0 });
    expect(lines.join("\n")).toContain("window clipped");
  });
});

describe("a reconciler that cannot read its own inputs", () => {
  it("is degraded, and writes nothing, when the tracker will not answer", () => {
    const fake = createFakeRuns({ issueListFails: true });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome.action).toBe("degraded");
    expect(fake.reopened).toEqual([]);
  });

  it("is degraded, and writes nothing, when the Actions log will not answer", () => {
    // The dangerous direction: an unreadable run list looks exactly like
    // "no run judged any of these", and acting on it would reopen every
    // close in the window.
    const fake = createFakeRuns({ issues: [closed(1, "2026-08-26T12:00:00Z")], runsFail: true });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome.action).toBe("degraded");
    expect(fake.reopened).toEqual([]);
  });

  it("is degraded when it cannot learn when the gate started", () => {
    // Without that floor every close before the gate shipped reads as
    // unjudged, which is the one failure that reopens history.
    const fake = createFakeRuns({
      issues: [closed(1, "2026-08-26T12:00:00Z")],
      gateStartFails: true,
    });
    const outcome = runReconcile({ now: NOW, gh: fake.gh, log: silent });

    expect(outcome.action).toBe("degraded");
    expect(fake.reopened).toEqual([]);
  });
});

// The dispatch action and the page size are each spelled twice — once in
// `reconcile.ts` and once in the workflow that runs it. No compiler sees
// across that language boundary, so a test does, the same way
// `close-gate.test.ts` and `run-audit.test.ts` pin theirs.
describe("close-gate-reconcile.yml agrees with the entrypoint it runs", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/close-gate-reconcile.yml", import.meta.url)),
    "utf8",
  );

  it("triggers on repository_dispatch", () => {
    expect(workflow).toMatch(/repository_dispatch/);
  });

  it("gates the job on the same dispatch action the entrypoint checks", () => {
    expect(workflow).toContain(`action == '${RECONCILE_DISPATCH_ACTION}'`);
  });

  it("runs the reconciler and installs no model CLI — this spends nothing", () => {
    expect(workflow).toContain("close-gate/reconcile.ts");
    expect(workflow).not.toContain("@anthropic-ai/claude-code");
    expect(workflow).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("can reopen an issue and cannot write to the tree", () => {
    expect(workflow).toMatch(/issues:\s*write/);
    expect(workflow).toMatch(/contents:\s*read/);
  });
});

describe("the gate it reconciles", () => {
  it("names the workflow file that actually holds the gate", () => {
    const workflows = fileURLToPath(new URL("../../../.github/workflows/", import.meta.url));
    expect(readFileSync(`${workflows}${GATE_WORKFLOW_FILE}`, "utf8")).toContain("name: Close gate");
  });

  it("asks for a page big enough to be worth clipping against", () => {
    expect(RUN_PAGE_SIZE).toBeGreaterThan(0);
    expect(RUN_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
