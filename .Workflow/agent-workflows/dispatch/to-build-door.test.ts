import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, test } from "vitest";
import { scratchDir } from "../shared/scratch.fixture";
import {
  ACCEPTING_LABEL,
  BUILDING_LABEL,
  BY_HAND_LABEL,
  NEEDS_HUMAN_LABEL,
  PRD_LABEL,
  SLICEABLE_LABEL,
  SLICED_LABEL,
  TICKET_LABEL,
} from "../shared/labels";
import { PRD_SLICEABLE_DISPATCH_ACTION } from "../shared/ready-set";
import { CLAIM_LIMIT } from "../shared/ticket-shape";
import { TO_BUILD_LABEL } from "./reconcile";
import {
  authoredOn,
  type FakeIssue,
  HAND_WRITTEN_TICKET,
  liveRun,
  reconcileOver,
  startedIssues,
  type Tracker,
  trackerWith,
  type TrackerOptions,
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
  const body = `## Acceptance criteria\n\n- [ ] ${CRITERION} - check: \`true\`\n\n## Files claimed\n\n- src/a.ts\n`;

  const atTheDoor = (): TrackerOptions => ({ open: [{ number: 77, title: "Door", body, labels: [TO_BUILD_LABEL] }] });

  const events = (tracker: Tracker) => tracker.dispatches.map((dispatch) => dispatch.eventType);

  it("asks lane 04 to author when no acceptance test names the ticket's criteria", () => {
    const tracker = trackerWith(atTheDoor());

    const outcome = reconcileOver(tracker);

    expect(events(tracker)).toContain("acceptance-wanted");
    expect(events(tracker), "lane 05 must not be rung before the tests exist").not.toContain("ticket-ready");
    expect(outcome.action, "handing a slice to lane 04 is not a quiet pass").toBe("dispatched");
  });

  it("rings lane 05 directly once an acceptance test names one of them, so a retry authors nothing new", () => {
    const tracker = trackerWith(authoredOn(atTheDoor(), [77]));

    reconcileOver(tracker);

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

  it("does not start a labelled ticket twice while a run carries it", () => {
    const tracker = trackerWith({ open: [labelled(620)], runs: [liveRun(901, "Implement #620")] });

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
      open: [
        {
          ...labelled(650),
          labels: [TO_BUILD_LABEL, NEEDS_HUMAN_LABEL],
          comments: [`Missing something.\n\n<!-- ${REFUSED_MARKER} -->`],
        },
      ],
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

  it("reads no comments at the door for a ticket it admits, since only its own refusal ever lives there", () => {
    const tracker = trackerWith({
      open: [{ number: 11, title: "Still building" }, labelled(661, HAND_WRITTEN_TICKET, [11])],
    });

    reconcileOver(tracker);

    expect(startedIssues(tracker)).not.toContain(661);
    expect(tracker.calls.filter((call) => call.some((arg) => arg.includes("/issues/661/comments")))).toEqual([]);
  });

  it("refuses and comments on nothing in a dry run", () => {
    const tracker = trackerWith({ open: [labelled(670, "## Acceptance criteria\n\n- [ ] It works — check: `true`\n")] });

    reconcileOver(tracker, { dryRun: true });

    expect(tracker.comments).toEqual([]);
    expect(tracker.dispatches).toEqual([]);
  });
});

describe("the to-build door refuses what bin/close-ticket would refuse", () => {
  const CHECKLESS = [
    "## What to build",
    "",
    "A red run named this path.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] `src/a.ts` no longer fails this way, at or after machine SHA `abc1234`",
    "",
    "## Files claimed",
    "",
    "- src/a.ts",
    "",
  ].join("\n");

  const ONE_CHECKED = CHECKLESS.replace("## Files claimed", "- [ ] It runs to the end — check: `true`\n\n## Files claimed");

  it("#371.1: a labelled ticket whose criteria carry no check at all is refused, and one where any criterion carries a check is admitted, the same line bin/close-ticket draws at close", () => {
    const refused = passOverLabelled(690, CHECKLESS);
    const admitted = passOverLabelled(691, ONE_CHECKED);

    expect(refused.dispatches).toEqual([]);
    expect(startedIssues(admitted)).toEqual([691]);
  });

  it("#371.2: the refusal stands on the ticket as the door's own comment and names the check: marker it wants", () => {
    const tracker = passOverLabelled(692, CHECKLESS);

    expect(tracker.comments).toHaveLength(1);
    expect(tracker.comments[0].issue).toBe(692);
    expect(tracker.comments[0].body).toContain(REFUSED_MARKER);
    expect(tracker.comments[0].body).toContain("check:");
  });
});

describe("the to-build swap and the lane-label door (#521)", () => {
  it("swaps to-build for 5-building the moment it dispatches, so the label is not permanent", () => {
    const tracker = trackerWith(authoredOn({ open: [labelled(710)] }, [710]));

    reconcileOver(tracker);

    expect(startedIssues(tracker)).toEqual([710]);
    expect(tracker.labelsAdded).toContainEqual({ issue: 710, name: BUILDING_LABEL });
    expect(tracker.labelsRemoved).toContainEqual({ issue: 710, name: TO_BUILD_LABEL });
  });

  it("swaps to-build for 4-accepting when it hands the ticket to the acceptance author first", () => {
    const tracker = trackerWith({ open: [labelled(711)] });

    reconcileOver(tracker);

    expect(tracker.labelsAdded).toContainEqual({ issue: 711, name: ACCEPTING_LABEL });
    expect(tracker.labelsRemoved).toContainEqual({ issue: 711, name: TO_BUILD_LABEL });
  });

  it("admits a ticket on its lane label once to-build is gone, so a dead run restarts without the owner", () => {
    const tracker = trackerWith({ open: [{ ...labelled(720), labels: [BUILDING_LABEL] }] });

    reconcileOver(tracker);

    expect(startedIssues(tracker)).toEqual([720]);
    expect(tracker.comments).toEqual([]);
  });

  it("never admits a spec or an idea on a lane label, whatever its body carries", () => {
    const tracker = trackerWith({
      open: [
        { ...labelled(730), labels: ["prd", SLICED_LABEL] },
        { ...labelled(731), labels: ["idea", "1-shaping"] },
      ],
    });

    reconcileOver(tracker);

    expect(tracker.dispatches).toEqual([]);
  });

  it("skips a started ticket at the door, so a running ticket is never re-commented", () => {
    const malformed = "## Acceptance criteria\n\n- [ ] It works — check: `true`\n";
    const tracker = trackerWith({ open: [labelled(740, malformed)], runs: [liveRun(940, "Implement #740")] });

    reconcileOver(tracker);

    expect(tracker.comments).toEqual([]);
    expect(tracker.labelsAdded.filter((label) => label.name === NEEDS_HUMAN_LABEL)).toEqual([]);
  });
});

function labelsRemovedFrom(tracker: Tracker, issue: number): string[] {
  return tracker.calls
    .filter((call) => call[0] === "issue" && call[1] === "edit" && call[2] === String(issue))
    .filter((call) => call.includes("--remove-label"))
    .map((call) => call[call.indexOf("--remove-label") + 1]);
}

test(
  "#472.1: a to-build ticket refused at the door carries needs-human after the run, a run that finds the shape fixed lifts it again, and the by-hand stand-down still never adds it",
  () => {
    const MALFORMED = "## Acceptance criteria\n\n- [ ] It works — check: `true`\n";

    const refused = trackerWith({ open: [labelled(700, MALFORMED)] });
    reconcileOver(refused);

    expect(refused.dispatches).toEqual([]);
    expect(refused.labelsAdded).toContainEqual({ issue: 700, name: NEEDS_HUMAN_LABEL });

    const fixed = trackerWith({
      open: [
        {
          ...labelled(701),
          labels: [TO_BUILD_LABEL, NEEDS_HUMAN_LABEL],
          comments: [`Missing something.\n\n<!-- ${REFUSED_MARKER} -->`],
        },
      ],
    });
    reconcileOver(fixed);

    expect(fixed.commentEdits).toHaveLength(1);
    expect(fixed.commentEdits[0].body).not.toContain(REFUSED_MARKER);
    expect(labelsRemovedFrom(fixed, 701)).toContain(NEEDS_HUMAN_LABEL);
    expect(
      startedIssues(fixed),
      "the label the door just lifted must not hold the same run's dispatch; its own unlabel never wakes another",
    ).toEqual([701]);

    const byHand = trackerWith({ open: [{ ...labelled(702), labels: [TO_BUILD_LABEL, BY_HAND_LABEL] }] });
    reconcileOver(byHand);

    expect(byHand.dispatches).toEqual([]);
    expect(byHand.labelsAdded.filter((label) => label.name === NEEDS_HUMAN_LABEL)).toEqual([]);
  },
);

describe("a claim only a human can build stands down, rather than being handed back as a repair", () => {
  const claiming = (path: string): string => HAND_WRITTEN_TICKET.replace("- None — no files.", `- ${path}`);

  it.each([
    { what: "the immutable set", path: ".github/workflows/integrate.yml" },
    { what: "the workstation", path: ".claude/settings.json" },
    { what: "the immutable set in backticks", path: "`.github/workflows/integrate.yml`" },
    { what: "the workstation in backticks", path: "`.claude/settings.json`" },
  ])("labels a claim on $what by-hand itself, instead of spending the owner on a needs-human hold", ({ path }) => {
    const tracker = passOverLabelled(630, claiming(path));

    expect(tracker.dispatches).toEqual([]);
    expect(tracker.labelsAdded).toContainEqual({ issue: 630, name: BY_HAND_LABEL });
    expect(tracker.labelsAdded.filter((label) => label.name === NEEDS_HUMAN_LABEL)).toEqual([]);
    expect(tracker.comments).toHaveLength(1);
    expect(tracker.comments[0].body).not.toContain(REFUSED_MARKER);
    expect(tracker.comments[0].body).toContain(BY_HAND_LABEL);
  });

  it("leaves the label alone when the owner already applied it, and still says nothing is owed", () => {
    const tracker = trackerWith({
      open: [{ ...labelled(631, claiming(".claude/settings.json")), labels: [TO_BUILD_LABEL, BY_HAND_LABEL] }],
    });

    reconcileOver(tracker);

    expect(tracker.labelsAdded.filter((label) => label.name === BY_HAND_LABEL)).toEqual([]);
    expect(tracker.comments).toHaveLength(1);
  });

  it("never admits such a claim on a lane label either, once to-build is gone", () => {
    const tracker = trackerWith({
      open: [{ ...labelled(632, claiming(".github/workflows/integrate.yml")), labels: [BUILDING_LABEL] }],
    });

    reconcileOver(tracker);

    expect(startedIssues(tracker)).toEqual([]);
  });
});

describe("a claim too wide for lane 04 is sliced, not handed back", () => {
  const overWide = (count: number): string =>
    [
      "## Acceptance criteria",
      "",
      "- [ ] `make gate` exits 0 — check: `make gate`",
      "",
      "## Files claimed",
      "",
      ...Array.from({ length: count }, (_unused, at) => `- src/m${at}.ts`),
      "",
    ].join("\n");

  const wide = () =>
    trackerWith({ open: [{ ...labelled(800), body: overWide(CLAIM_LIMIT + 1), labels: [TO_BUILD_LABEL, TICKET_LABEL] }] });

  it("rings lane 03 instead of stamping the owner's label", () => {
    const tracker = wide();

    reconcileOver(tracker);

    expect(tracker.dispatches.map((dispatch) => dispatch.eventType)).toEqual([PRD_SLICEABLE_DISPATCH_ACTION]);
    expect(tracker.labelsAdded.filter((label) => label.name === NEEDS_HUMAN_LABEL)).toEqual([]);
  });

  it("relabels it as the spec it turned out to be, so lane 03's own doors read it", () => {
    const tracker = wide();

    reconcileOver(tracker);

    expect(tracker.labelsAdded).toContainEqual({ issue: 800, name: PRD_LABEL });
    expect(tracker.labelsAdded).toContainEqual({ issue: 800, name: SLICEABLE_LABEL });
    expect(tracker.labelsRemoved).toContainEqual({ issue: 800, name: TICKET_LABEL });
    expect(tracker.labelsRemoved).toContainEqual({ issue: 800, name: TO_BUILD_LABEL });
  });

  it("says on the ticket that nobody owes it anything", () => {
    const tracker = wide();

    reconcileOver(tracker);

    const said = tracker.comments.filter((comment) => comment.issue === 800);
    expect(said).toHaveLength(1);
    expect(said[0].body).toContain(String(CLAIM_LIMIT + 1));
    expect(said[0].body).not.toContain(REFUSED_MARKER);
  });

  it("rings lane 03 once, however many times the reconciler reads the same issue", () => {
    const tracker = trackerWith({
      open: [
        {
          ...labelled(801),
          body: overWide(CLAIM_LIMIT + 1),
          labels: [TO_BUILD_LABEL, TICKET_LABEL],
          comments: ["Already sent.\n\n<!-- sent-to-slicing:v1 -->"],
        },
      ],
    });

    reconcileOver(tracker);

    expect(tracker.dispatches).toEqual([]);
    expect(tracker.comments.filter((comment) => comment.issue === 801)).toEqual([]);
  });

  it("leaves a claim sitting on the ceiling alone", () => {
    const tracker = trackerWith({
      open: [{ ...labelled(802), body: overWide(CLAIM_LIMIT), labels: [TO_BUILD_LABEL, TICKET_LABEL] }],
    });

    reconcileOver(tracker);

    expect(tracker.dispatches.map((dispatch) => dispatch.eventType)).not.toContain(PRD_SLICEABLE_DISPATCH_ACTION);
  });

  it("lets a by-hand ticket stand down rather than slicing work no pull request may land", () => {
    const tracker = trackerWith({
      open: [
        {
          ...labelled(803),
          body: overWide(CLAIM_LIMIT + 1),
          labels: [TO_BUILD_LABEL, TICKET_LABEL, BY_HAND_LABEL],
        },
      ],
    });

    reconcileOver(tracker);

    expect(tracker.dispatches).toEqual([]);
    expect(tracker.labelsAdded.filter((label) => label.name === PRD_LABEL)).toEqual([]);
  });
});
