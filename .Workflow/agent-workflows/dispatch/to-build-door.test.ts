import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchDir } from "../shared/scratch.fixture";
import { TO_BUILD_LABEL } from "./reconcile";
import {
  type FakeIssue,
  HAND_WRITTEN_TICKET,
  reconcileOver,
  startedIssues,
  type Tracker,
  trackerWith,
} from "./tracker.fixture";

const REFUSED_MARKER = "to-build-refused:v1";

const labelled = (number: number, body = HAND_WRITTEN_TICKET, blockedBy?: number[]): FakeIssue => ({
  number,
  title: "A ticket the owner wrote in full",
  body,
  labels: [TO_BUILD_LABEL],
  blockedBy,
});

function passOverLabelled(...issue: Parameters<typeof labelled>): Tracker {
  const tracker = trackerWith({ open: [labelled(...issue)] });
  reconcileOver(tracker);
  return tracker;
}

describe("the to-build door goes through lane 04, not straight to lane 05", () => {
  const CRITERION = "The door asks lane 04 first";
  const body = `## Acceptance criteria\n\n- [ ] ${CRITERION}\n\n## Files claimed\n\n- src/a.ts\n`;

  function target(withTest: boolean): string {
    const dir = scratchDir("reconcile-door");
    const tests = join(dir, ".Workflow", "door");
    mkdirSync(tests, { recursive: true });
    if (withTest) writeFileSync(join(tests, "door.test.ts"), 'it.fails("#77: x", () => {});\n');
    return dir;
  }

  const events = (tracker: Tracker) => tracker.dispatches.map((dispatch) => dispatch.eventType);

  it("asks lane 04 to author when no acceptance test names the ticket's criteria", () => {
    const tracker = trackerWith({ open: [{ number: 77, title: "Door", body, labels: [TO_BUILD_LABEL] }] });

    const outcome = reconcileOver(tracker, { targetWorkspace: target(false) });

    expect(events(tracker)).toContain("acceptance-wanted");
    expect(events(tracker), "lane 05 must not be rung before the tests exist").not.toContain("ticket-ready");
    expect(outcome.action, "handing a slice to lane 04 is not a quiet pass").toBe("dispatched");
  });

  it("rings lane 05 directly once an acceptance test names one of them, so a retry authors nothing new", () => {
    const tracker = trackerWith({ open: [{ number: 77, title: "Door", body, labels: [TO_BUILD_LABEL] }] });

    reconcileOver(tracker, { targetWorkspace: target(true) });

    expect(events(tracker)).toContain("ticket-ready");
    expect(events(tracker), "re-authoring costs a model run for nothing").not.toContain("acceptance-wanted");
  });
});

describe("the to-build door into lane 06 (#184)", () => {
  it("starts a labelled ticket carrying no ## Parent PRD heading at all", () => {
    const tracker = trackerWith({ open: [labelled(600)] });

    const outcome = reconcileOver(tracker);

    expect(startedIssues(tracker)).toEqual([600]);
    expect(outcome.action).toBe("dispatched");
  });

  it("holds a labelled ticket behind an open blocker, and starts it on the recompute after that blocker delivers", () => {
    const blocked = trackerWith({
      open: [{ number: 11, title: "Still building" }, labelled(610, HAND_WRITTEN_TICKET, [11])],
    });
    reconcileOver(blocked);
    expect(startedIssues(blocked)).not.toContain(610);

    const cleared = trackerWith({
      open: [labelled(610, HAND_WRITTEN_TICKET, [11])],
      closed: [{ number: 11, stateReason: "completed", merged: true }],
    });
    reconcileOver(cleared);

    expect(startedIssues(cleared)).toEqual([610]);
  });

  it("does not start a labelled ticket twice, since the implement/issue-<n> ref is still the claim", () => {
    const tracker = trackerWith({ open: [labelled(620)], claimed: ["implement/issue-620"] });

    const outcome = reconcileOver(tracker);

    expect(tracker.dispatches).toEqual([]);
    expect(outcome.action).toBe("clear");
  });

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
    {
      what: "a ## Files claimed that touches the immutable set",
      body: HAND_WRITTEN_TICKET.replace("- None — no files.", "- .github/workflows/integrate.yml"),
      names: ".github/workflows/integrate.yml",
    },
  ])("refuses a labelled ticket with $what, starting nothing and saying what is wrong", ({ body, names }) => {
    const tracker = passOverLabelled(630, body);

    expect(tracker.dispatches).toEqual([]);
    expect(tracker.comments).toHaveLength(1);
    expect(tracker.comments[0].issue).toBe(630);
    expect(tracker.comments[0].body).toContain(names);
    expect(tracker.comments[0].body).toContain(REFUSED_MARKER);
  });

  it("admits a labelled ticket whose ## Files claimed touches only mutable paths", () => {
    const tracker = passOverLabelled(681, HAND_WRITTEN_TICKET.replace("- None — no files.", "- src/router/index.ts"));

    expect(startedIssues(tracker)).toEqual([681]);
    expect(tracker.comments).toEqual([]);
  });

  it("says it once, and a second recompute over the same state writes nothing further", () => {
    const malformed = "## Acceptance criteria\n\n- [ ] It works — check: `true`\n";
    const first = passOverLabelled(640, malformed);

    const second = trackerWith({ open: [{ ...labelled(640, malformed), comments: [first.comments[0].body] }] });
    reconcileOver(second);

    expect(second.comments).toEqual([]);
    expect(second.commentEdits).toEqual([]);
  });

  it("rewrites its standing refusal, and drops the marker, once the body validates and the ticket starts", () => {
    const stale = trackerWith({
      open: [{ ...labelled(650), comments: [`Missing something.\n\n<!-- ${REFUSED_MARKER} -->`] }],
    });

    reconcileOver(stale);

    expect(startedIssues(stale)).toEqual([650]);
    expect(stale.commentEdits).toHaveLength(1);
    expect(stale.commentEdits[0].body).not.toContain(REFUSED_MARKER);
  });

  it("writes nothing at all to an issue it neither refuses nor has anything standing on", () => {
    const tracker = passOverLabelled(660);

    expect(tracker.comments).toEqual([]);
    expect(tracker.commentEdits).toEqual([]);
  });

  it("refuses and comments on nothing in a dry run", () => {
    const tracker = trackerWith({ open: [labelled(670, "## Acceptance criteria\n\n- [ ] It works — check: `true`\n")] });

    reconcileOver(tracker, { dryRun: true });

    expect(tracker.comments).toEqual([]);
    expect(tracker.dispatches).toEqual([]);
  });
});
