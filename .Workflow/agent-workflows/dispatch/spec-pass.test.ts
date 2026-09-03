import { realpathSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CloseTicketResult } from "../shared/close-ticket";
import { scratchDir } from "../shared/scratch.fixture";
import { runRealSpecClose } from "./reconcile";
import {
  commentsCarrying,
  delivered,
  type FakeIssue,
  reconcileOver,
  RUNNABLE_BODY,
  type Tracker,
  type TrackerOptions,
  trackerWith,
} from "./tracker.fixture";

const closeTicketProcessCalls: (readonly string[])[] = [];
vi.mock("../shared/close-ticket", () => ({
  closeTicketProcess: (args: readonly string[]) => {
    closeTicketProcessCalls.push(args);
    return { exitCode: 0, output: "" };
  },
}));

/**
 * Lane 09's two passes over a `prd` issue: the spec-evaluate pass (#237), which runs a runnable
 * spec's own `check:` and records the verdict as one upserted comment, and the spec-closing pass
 * (#233), which hands a green spec whose every child delivered to `bin/close-ticket --spec`.
 */

const VERDICT = "prd-check:v1";
const UNRUNNABLE = "prd-unrunnable:v1";

/** A runnable spec carrying `children`, which is the only thing that differs between most cases. */
function spec(number: number, children: number[], body: string = RUNNABLE_BODY): FakeIssue {
  return { number, title: "A spec", body, labels: ["prd"], children };
}

/** One reconcile pass over a tracker holding exactly one open issue, returning the tracker. */
function passOver(issue: FakeIssue): Tracker {
  const tracker = trackerWith({ open: [issue] });
  reconcileOver(tracker);
  return tracker;
}

describe("runReconcile's spec-evaluate pass (#237)", () => {
  const UNRUNNABLE_BODY = [
    "## Acceptance criteria",
    "",
    "- [ ] I'll know it works when I can see a verdict — check: `true`",
    "- [ ] And also when I can see the second thing — check: `true`",
    "",
  ].join("\n");

  it("upserts prd-check:v1 for a runnable spec with a sub-issue, and writes neither prd-unrunnable:v1 nor needs-human", () => {
    const tracker = passOver(spec(300, [301]));

    expect(commentsCarrying(tracker, VERDICT).length).toBeGreaterThan(0);
    expect(commentsCarrying(tracker, UNRUNNABLE)).toEqual([]);
    expect(tracker.labelsAdded.map((entry) => entry.name)).not.toContain("needs-human");
  });

  it("upserts prd-unrunnable:v1 and needs-human for a spec whose body cannot run, and never prd-check:v1", () => {
    const tracker = passOver(spec(310, [311], UNRUNNABLE_BODY));

    expect(commentsCarrying(tracker, UNRUNNABLE).length).toBeGreaterThan(0);
    expect(commentsCarrying(tracker, VERDICT)).toEqual([]);
    expect(tracker.labelsAdded.map((entry) => entry.name)).toContain("needs-human");
  });

  it.each([
    { what: "a prd issue that has grown no sub-issue yet", issue: spec(320, []) },
    {
      what: "an open issue that isn't labelled prd, however ready it looks",
      issue: { number: 325, title: "Not a spec", body: RUNNABLE_BODY, labels: [], children: [326] },
    },
  ])("never evaluates $what", ({ issue }) => {
    const tracker = passOver(issue);

    expect(commentsCarrying(tracker, VERDICT)).toEqual([]);
    expect(commentsCarrying(tracker, UNRUNNABLE)).toEqual([]);
  });

  it("clears the needs-human it set, in the same act that rewrites its own refusal to a verdict", () => {
    const tracker = passOver({
      ...spec(330, [331]),
      labels: ["prd", "needs-human"],
      comments: [`Could not run this spec's check: its body carried two criteria.\n\n<!-- ${UNRUNNABLE} -->`],
    });

    expect(commentsCarrying(tracker, VERDICT).length).toBeGreaterThan(0);
    expect(tracker.labelsRemoved).toEqual([{ issue: 330, name: "needs-human" }]);
  });

  it("leaves a needs-human another lane wrote alone, even while writing that spec's verdict", () => {
    const tracker = passOver({
      ...spec(340, [341]),
      labels: ["prd", "needs-human"],
      // No prd-unrunnable:v1 anywhere on it — this needs-human isn't paired with this pass.
      comments: ["A criterion is still unmet after the fix pass.\n\n<!-- fix-pass:v1 -->"],
    });

    expect(commentsCarrying(tracker, VERDICT).length).toBeGreaterThan(0);
    expect(tracker.labelsRemoved).toEqual([]);
  });

  /**
   * `runCheckCommand` used to spawn a criterion's `check:` command with no `cwd` at all, which
   * defaults to `process.cwd()` — this process's own machine checkout, not the target the spec
   * describes. `pwd` names the directory a shell command actually ran in, so a verdict comment
   * that echoes it back is direct evidence of which checkout the check saw.
   */
  it("runs a spec's own check: command against targetWorkspace, not this process's own cwd", () => {
    const targetWorkspace = realpathSync(scratchDir("reconcile-target"));
    const body = ["## Acceptance criteria", "", "- [ ] It works — check: `pwd`", ""].join("\n");
    const tracker = trackerWith({ open: [spec(350, [351], body)] });

    reconcileOver(tracker, { targetWorkspace });

    const verdicts = commentsCarrying(tracker, VERDICT);
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
 * `bin/close-ticket --spec` — injected here the way lane 08's tests inject `closeTicket` — runs
 * against a range synthesized from its children's own delivering merges, and never runs at all
 * with an undelivered child.
 */
describe("runReconcile's spec-closing pass (#233)", () => {
  interface CloseCall {
    number: number;
    range: string;
  }

  /**
   * Builds the tracker `setup` describes, runs the pass over it with a closer answering `result`,
   * and hands back every closer invocation in call order — so each case spells out only the
   * tracker it starts from, which is the thing it is actually about.
   */
  function runClosingPass(setup: TrackerOptions, result: CloseTicketResult = { exitCode: 0, output: "" }): CloseCall[] {
    const calls: CloseCall[] = [];
    reconcileOver(trackerWith(setup), {
      closeSpec: (number, range) => {
        calls.push({ number, range });
        return result;
      },
    });
    return calls;
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
    const tracker = trackerWith({
      open: [spec(480, [481])],
      closed: [delivered(481, "2026-01-01T00:00:00Z", "sha444")],
    });

    reconcileOver(tracker, {
      closeSpec: () => ({ exitCode: 1, output: "error: #481 is not delivered enough after all" }),
    });

    const verdicts = commentsCarrying(tracker, VERDICT);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toContain("exit 0");
    expect(verdicts[0]).toContain("bin/close-ticket --spec");
    expect(verdicts[0]).toContain("exit 1");
    expect(verdicts[0]).toContain("error: #481 is not delivered enough after all");

    expect(tracker.labelsAdded.map((entry) => entry.name)).not.toContain("needs-human");
    expect(tracker.closedByRun).toEqual([]);
  });
});
