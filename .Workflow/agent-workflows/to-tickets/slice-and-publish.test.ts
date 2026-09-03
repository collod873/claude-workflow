import { describe, expect, it } from "vitest";
import { blockedByPath } from "../shared/gh-paths";
import { createFakeGh } from "../shared/gh.fake";
import { slice } from "../shared/plan.fixture";
import type { Slice } from "../shared/plan-schema";
import { readySlices, type SliceState } from "../shared/ready-set";
import { ACCEPTANCE_WANTED_DISPATCH_ACTION } from "../shared/ready-set";
import { sliceAndPublish } from "./slice-and-publish";

const PRD_NUMBER = 42;

function blockedByWrites(calls: string[][]): string[][] {
  return calls.filter(
    (args) =>
      args[0] === "api" &&
      typeof args[1] === "string" &&
      args[1].endsWith("/dependencies/blocked_by") &&
      args.includes("-F"),
  );
}

function publishedBody(plan: Slice[]): string {
  const fake = createFakeGh();

  sliceAndPublish(plan, PRD_NUMBER, fake.gh);

  const createCall = fake.calls.find((args) => args[0] === "issue" && args[1] === "create");
  return createCall![createCall!.indexOf("--body") + 1];
}

describe("sliceAndPublish", () => {
  it("creates an issue for every slice and attaches each under the PRD", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    expect(published.map((p) => p.title)).toEqual(["Root", "Depends on root"]);

    const createCalls = fake.calls.filter((args) => args[0] === "issue" && args[1] === "create");
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]).toEqual(
      expect.arrayContaining(["--title", "Root"]),
    );
    expect(createCalls[1]).toEqual(
      expect.arrayContaining(["--title", "Depends on root"]),
    );

    const attached = fake.subIssuesByParent.get(PRD_NUMBER) ?? [];
    expect(attached).toHaveLength(2);
    expect(attached).toEqual(published.map((p) => p.id));
  });

  it("wires a native blocked-by edge for every dependsOn entry in the plan", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Depends on root", dependsOn: [1] }),
      slice({ title: "Depends on both", dependsOn: [1, 2] }),
    ];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);
    const [root, dependsOnRoot, dependsOnBoth] = published;

    const wireCalls = blockedByWrites(fake.calls);
    expect(wireCalls).toHaveLength(3);

    expect(wireCalls).toContainEqual([
      "api",
      "repos/{owner}/{repo}/issues/101/dependencies/blocked_by",
      "-F",
      "issue_id=100007",
    ]);
    expect(wireCalls).toContainEqual([
      "api",
      blockedByPath(dependsOnBoth.number),
      "-F",
      `issue_id=${root.id}`,
    ]);
    expect(wireCalls).toContainEqual([
      "api",
      blockedByPath(dependsOnBoth.number),
      "-F",
      `issue_id=${dependsOnRoot.id}`,
    ]);
  });

  it("wires no blocked-by edge for a slice with no dependsOn", () => {
    const plan = [slice({ title: "Root" })];
    const fake = createFakeGh();

    sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    const wireCalls = fake.calls.filter(
      (args) =>
        args[0] === "api" && typeof args[1] === "string" && args[1].endsWith("/dependencies/blocked_by"),
    );
    expect(wireCalls).toHaveLength(0);
  });

  it("passes read-back verification and returns normally when the published graph matches", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).not.toThrow();
  });

  it("fails read-back verification, naming the exact missing edge, when a wired edge never lands", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const fake = createFakeGh({ dropEdges: [{ blockedNumber: 101, blockerNumber: 100 }] });

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(
      /slice 2 \("Depends on root"\).*blocked by slice 1 \("Root"\)/,
    );

    expect(blockedByWrites(fake.calls)).toHaveLength(1);
  });

  it("refuses an out-of-range dependsOn, naming the offending slice, with zero argv recorded", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Points past the end", dependsOn: [7] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(
      /slice 2 \("Points past the end"\).*out-of-range/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a self-reference, naming the offending slice, with zero argv recorded", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on itself", dependsOn: [2] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(
      /slice 2 \("Depends on itself"\).*depends on itself/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a cycle, naming the offending slices, with zero argv recorded", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Cycle A", dependsOn: [3] }),
      slice({ title: "Cycle B", dependsOn: [2] }),
    ];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(
      /dependency cycle detected/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a graph with no unblocked root, with zero argv recorded", () => {
    const plan = [slice({ title: "First", dependsOn: [2] }), slice({ title: "Second", dependsOn: [1] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(/no unblocked root/);
    expect(fake.calls).toHaveLength(0);
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
    const seamLine = "`GhExec` — the injected gh argv executor — shared/gh.ts — consumed by everything.";
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

describe("sliceAndPublish asks lane 04 to author acceptance tests for every published slice", () => {
  it("sends one acceptance-wanted dispatch per published slice, naming its issue", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Also depends on root", dependsOn: [1] }),
      slice({ title: "Depends on root", dependsOn: [1] }),
    ];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    expect(fake.dispatches.map((d) => d.eventType)).toEqual([
      ACCEPTANCE_WANTED_DISPATCH_ACTION,
      ACCEPTANCE_WANTED_DISPATCH_ACTION,
      ACCEPTANCE_WANTED_DISPATCH_ACTION,
    ]);
    expect(fake.dispatches.map((d) => d.payload.issue)).toEqual([
      String(published[0].number),
      String(published[1].number),
      String(published[2].number),
    ]);
  });

  it("flags a slice with no blocked-by edges as ready, and a blocked one as not", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Blocked", dependsOn: [1] })];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    expect(fake.dispatches).toHaveLength(2);
    expect(fake.dispatches[0].payload).toEqual({ issue: String(published[0].number), ready: "1" });
    expect(fake.dispatches[1].payload).toEqual({ issue: String(published[1].number), ready: "0" });
  });

  it("dispatches only after the blocked-by read-back has verified the graph", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Blocked", dependsOn: [1] })];
    const fake = createFakeGh();

    sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    const readBacks = fake.calls
      .map((args, index) => ({ args, index }))
      .filter(({ args }) => args[0] === "api" && args[1]?.endsWith("dependencies/blocked_by") && !args.includes("-F"));
    const lastReadBack = readBacks.length === 0 ? -1 : readBacks[readBacks.length - 1].index;
    const firstDispatch = fake.calls.findIndex(
      (args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches",
    );
    expect(lastReadBack).toBeGreaterThan(-1);
    expect(firstDispatch).toBeGreaterThan(lastReadBack);
  });

  it("gives the same answer the predicate gives for the state a publish is in", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Blocked", dependsOn: [1] }),
      slice({ title: "Also blocked", dependsOn: [1] }),
    ];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    const states: SliceState[] = [
      { number: published[0].number, blockedBy: [], delivery: "open", started: false },
      { number: published[1].number, blockedBy: [published[0].number], delivery: "open", started: false },
      { number: published[2].number, blockedBy: [published[0].number], delivery: "open", started: false },
    ];

    const readyNumbers = new Set(readySlices(states).map((state) => state.number));
    expect(fake.dispatches.map((dispatch) => Number(dispatch.payload.issue))).toEqual(
      published.map((issue) => issue.number),
    );
    expect(fake.dispatches.map((dispatch) => dispatch.payload.ready)).toEqual(
      published.map((issue) => (readyNumbers.has(issue.number) ? "1" : "0")),
    );
  });

  it("throws before dispatching anything when the graph fails its read-back", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Blocked", dependsOn: [1] })];
    const fake = createFakeGh({ dropEdges: [{ blockedNumber: 101, blockerNumber: 100 }] });

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow();
    expect(fake.dispatches).toEqual([]);
  });
});
