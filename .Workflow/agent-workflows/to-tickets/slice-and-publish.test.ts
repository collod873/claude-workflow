import { afterEach, describe, expect, it, test, vi } from "vitest";
import type { GhExec } from "../shared/gh";
import { slice } from "../shared/plan.fixture";
import type { Slice } from "../shared/plan-schema";
import type { CreateIssueInput, Tracker, TrackerDispatchRequest } from "../shared/tracker";
import { trackerMemory } from "../shared/tracker-memory";
import { sliceAndPublish } from "./slice-and-publish";

const PRD_NUMBER = 42;

interface WiredTracker {
  tracker: Tracker;
  createdIssues: CreateIssueInput[];
  subIssuesByParent: Map<number, number[]>;
  blockedByWrites: Array<{ blockedNumber: number; blockerId: number }>;
  dispatches: TrackerDispatchRequest[];
}

function wireTracker(
  options: { firstIssueNumber?: number; dropEdges?: Array<{ blockedNumber: number; blockerNumber: number }> } = {},
): WiredTracker {
  const firstIssueNumber = options.firstIssueNumber ?? 99;
  const dropEdges = options.dropEdges ?? [];
  const issueIds: Record<number, number> = {};
  const numberById = new Map<number, number>();
  for (let i = 1; i <= 20; i++) {
    const number = firstIssueNumber + i;
    const id = number * 1000 + 7;
    issueIds[number] = id;
    numberById.set(id, number);
  }

  const createdIssues: CreateIssueInput[] = [];
  const subIssuesByParent = new Map<number, number[]>();
  const blockedByWrites: Array<{ blockedNumber: number; blockerId: number }> = [];
  const dispatches: TrackerDispatchRequest[] = [];

  const base = trackerMemory({ firstIssueNumber, issueIds, createdIssues });

  const tracker: Tracker = {
    ...base,
    addSubIssue(parentNumber, childId) {
      const list = subIssuesByParent.get(parentNumber) ?? [];
      list.push(childId);
      subIssuesByParent.set(parentNumber, list);
    },
    addBlockedBy(number, blockerId) {
      blockedByWrites.push({ blockedNumber: number, blockerId });
      const blockerNumber = numberById.get(blockerId);
      const dropped = dropEdges.some((edge) => edge.blockedNumber === number && edge.blockerNumber === blockerNumber);
      if (!dropped) base.addBlockedBy(number, blockerId);
    },
    dispatch(request) {
      dispatches.push(request);
    },
  };

  return { tracker, createdIssues, subIssuesByParent, blockedByWrites, dispatches };
}

function publishedBody(plan: Slice[]): string {
  const { tracker, createdIssues } = wireTracker();

  sliceAndPublish(plan, PRD_NUMBER, tracker);

  return createdIssues[0].body;
}

describe("sliceAndPublish", () => {
  it("creates an issue for every slice and attaches each under the PRD", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const { tracker, createdIssues, subIssuesByParent } = wireTracker();

    const published = sliceAndPublish(plan, PRD_NUMBER, tracker);

    expect(published.map((p) => p.title)).toEqual(["Root", "Depends on root"]);

    expect(createdIssues).toHaveLength(2);
    expect(createdIssues[0].title).toBe("Root");
    expect(createdIssues[1].title).toBe("Depends on root");

    const attached = subIssuesByParent.get(PRD_NUMBER) ?? [];
    expect(attached).toHaveLength(2);
    expect(attached).toEqual(published.map((p) => p.id));
  });

  it("wires a native blocked-by edge for every dependsOn entry in the plan", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Depends on root", dependsOn: [1] }),
      slice({ title: "Depends on both", dependsOn: [1, 2] }),
    ];
    const { tracker, blockedByWrites } = wireTracker();

    const published = sliceAndPublish(plan, PRD_NUMBER, tracker);
    const [root, dependsOnRoot, dependsOnBoth] = published;

    expect(blockedByWrites).toHaveLength(3);
    expect(blockedByWrites).toContainEqual({ blockedNumber: dependsOnRoot.number, blockerId: root.id });
    expect(blockedByWrites).toContainEqual({ blockedNumber: dependsOnBoth.number, blockerId: root.id });
    expect(blockedByWrites).toContainEqual({ blockedNumber: dependsOnBoth.number, blockerId: dependsOnRoot.id });
  });

  it("wires no blocked-by edge for a slice with no dependsOn", () => {
    const plan = [slice({ title: "Root" })];
    const { tracker, blockedByWrites } = wireTracker();

    sliceAndPublish(plan, PRD_NUMBER, tracker);

    expect(blockedByWrites).toHaveLength(0);
  });

  it("passes read-back verification and returns normally when the published graph matches", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const { tracker } = wireTracker();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, tracker)).not.toThrow();
  });

  it("fails read-back verification, naming the exact missing edge, when a wired edge never lands", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const { tracker, blockedByWrites } = wireTracker({ dropEdges: [{ blockedNumber: 101, blockerNumber: 100 }] });

    expect(() => sliceAndPublish(plan, PRD_NUMBER, tracker)).toThrow(
      /slice 2 \("Depends on root"\).*blocked by slice 1 \("Root"\)/,
    );

    expect(blockedByWrites).toHaveLength(1);
  });

  it("refuses an out-of-range dependsOn, naming the offending slice, with zero issues created", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Points past the end", dependsOn: [7] })];
    const { tracker, createdIssues } = wireTracker();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, tracker)).toThrow(
      /slice 2 \("Points past the end"\).*out-of-range/,
    );
    expect(createdIssues).toHaveLength(0);
  });

  it("refuses a self-reference, naming the offending slice, with zero issues created", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on itself", dependsOn: [2] })];
    const { tracker, createdIssues } = wireTracker();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, tracker)).toThrow(
      /slice 2 \("Depends on itself"\).*depends on itself/,
    );
    expect(createdIssues).toHaveLength(0);
  });

  it("refuses a cycle, naming the offending slices, with zero issues created", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Cycle A", dependsOn: [3] }),
      slice({ title: "Cycle B", dependsOn: [2] }),
    ];
    const { tracker, createdIssues } = wireTracker();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, tracker)).toThrow(/dependency cycle detected/);
    expect(createdIssues).toHaveLength(0);
  });

  it("refuses a graph with no unblocked root, with zero issues created", () => {
    const plan = [slice({ title: "First", dependsOn: [2] }), slice({ title: "Second", dependsOn: [1] })];
    const { tracker, createdIssues } = wireTracker();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, tracker)).toThrow(/no unblocked root/);
    expect(createdIssues).toHaveLength(0);
  });

  it("renders a body with all four headings in order, criteria as checkboxes, and no Closes directive", () => {
    const body = publishedBody([
      slice({
        title: "Root",
        acceptanceCriteria: [
          "First thing is true — check: `make test`",
          "Second thing is true — check: `npm run lint`",
        ],
        filesClaimed: ["bin/b.ts", "bin/c.ts"],
      }),
    ]);

    const headingOrder = ["## Parent PRD", "## What to build", "## Acceptance criteria", "## Files claimed"];
    const positions = headingOrder.map((heading) => body.indexOf(heading));
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    expect(body).toContain(`#${PRD_NUMBER}`);
    expect(body).toContain("- [ ] First thing is true — check: `make test`");
    expect(body).toContain("- [ ] Second thing is true — check: `npm run lint`");
    expect(body).toContain("- bin/b.ts");
    expect(body).toContain("- bin/c.ts");
    expect(body).not.toMatch(/closes/i);
  });

  it("renders an empty filesClaimed as the None sentinel", () => {
    const body = publishedBody([slice({ title: "No files touched", filesClaimed: [] })]);

    expect(body).toContain("- None — no files.");
  });

  it("renders seamsConsumed lines in the body without ever treating them as a Files claimed bullet", () => {
    const seamLine = "`GhExec`: the injected gh argv executor, at shared/gh.ts, consumed by everything.";
    const body = publishedBody([
      slice({
        title: "Consumes a seam",
        filesClaimed: ["docs/only/this/file.ts"],
        seamsConsumed: [seamLine],
      }),
    ]);

    expect(body).toContain(seamLine);

    const filesSection = body.slice(
      body.indexOf("## Files claimed"),
      body.indexOf("## Seams consumed") === -1 ? undefined : body.indexOf("## Seams consumed"),
    );
    expect(filesSection).toContain("- docs/only/this/file.ts");
    expect(filesSection).not.toContain(seamLine);
  });
});

describe("sliceAndPublish rings no lane, leaving the recompute to notice the published slices", () => {
  it("publishes every slice and dispatches nothing", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Also depends on root", dependsOn: [1] }),
      slice({ title: "Depends on root", dependsOn: [1] }),
    ];
    const { tracker, dispatches } = wireTracker();

    const published = sliceAndPublish(plan, PRD_NUMBER, tracker);

    expect(published).toHaveLength(plan.length);
    expect(dispatches).toEqual([]);
  });

  it("throws when the graph fails its read-back", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Blocked", dependsOn: [1] })];
    const { tracker } = wireTracker({ dropEdges: [{ blockedNumber: 101, blockerNumber: 100 }] });

    expect(() => sliceAndPublish(plan, PRD_NUMBER, tracker)).toThrow();
  });
});

describe("sliceAndPublish is driven off a Tracker rather than a raw GhExec", () => {
  test("#613.2: sliceAndPublish drives the whole publish off a Tracker built by trackerMemory, with no callable GhExec anywhere in its dependencies", () => {
    const createdIssues: CreateIssueInput[] = [];
    const tracker = trackerMemory({ firstIssueNumber: 999, issueIds: { 1000: 555000 }, createdIssues });
    const plan = [slice({ title: "Root" })];

    const published = sliceAndPublish(plan, PRD_NUMBER, tracker as unknown as GhExec);

    expect(published).toEqual([{ position: 1, title: "Root", number: 1000, id: 555000 }]);
    expect(createdIssues).toHaveLength(1);
    expect(createdIssues[0].title).toBe("Root");
  });
});

describe("a repair the publisher makes is a repair it reports", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("#584.5: sliceAndPublish prints one line per rooted claim, naming the path as written and as rooted, before it creates anything", () => {
    const { tracker } = wireTracker();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const plan = [slice({ title: "Rooted for me", filesClaimed: ["agent-workflows/shared/render-body.ts"] })];

    sliceAndPublish(plan, PRD_NUMBER, tracker);

    const printed = logSpy.mock.calls.map((call) => String(call[0]));
    expect(
      printed.some(
        (line) =>
          line.includes("agent-workflows/shared/render-body.ts") &&
          line.includes(".Workflow/agent-workflows/shared/render-body.ts"),
      ),
    ).toBe(true);
  });
});
