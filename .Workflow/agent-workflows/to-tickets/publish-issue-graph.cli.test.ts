import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { slice } from "../shared/plan.fixture";
import { scratchDir } from "../shared/scratch.fixture";
import type { CreateIssueInput } from "../shared/tracker";
import { trackerMemory } from "../shared/tracker-memory";
import { runPublishIssueGraphCli } from "./publish-issue-graph.cli";

function writeGraph(parent: number, plan: unknown): string {
  const dir = scratchDir("publish-issue-graph-cli");
  const file = join(dir, "graph.json");
  writeFileSync(file, JSON.stringify({ parent, plan }));
  return file;
}

function issueCreateCalls(calls: string[][]): string[][] {
  return calls.filter((args) => args[0] === "issue" && args[1] === "create");
}

describe("publish-issue-graph.cli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("#603.2: publishes through sliceAndPublish and prints one table row per slice with position, number and title", () => {
    const fake = createFakeGh();
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const file = writeGraph(42, plan);

    const table = runPublishIssueGraphCli([file], fake.gh);

    expect(issueCreateCalls(fake.calls)).toHaveLength(2);

    const rootRow = table.split("\n").find((line) => line.includes("Root"));
    expect(rootRow).toContain("1");
    expect(rootRow).toContain("100");

    const dependentRow = table.split("\n").find((line) => line.includes("Depends on root"));
    expect(dependentRow).toContain("2");
    expect(dependentRow).toContain("101");
  });

  test("#603.3: an out-of-range dependsOn exits nonzero, naming the slice position and the rule, with zero gh calls", () => {
    const fake = createFakeGh();
    const plan = [slice({ title: "Root" }), slice({ title: "Off the end", dependsOn: [9] })];
    const file = writeGraph(42, plan);

    expect(() => runPublishIssueGraphCli([file], fake.gh)).toThrow(/slice 2 \("Off the end"\).*out-of-range/);
    expect(fake.calls).toHaveLength(0);
  });

  test("#603.3: a dependsOn cycle exits nonzero, naming the slice positions and the rule, with zero gh calls", () => {
    const fake = createFakeGh();
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Cycle A", dependsOn: [3] }),
      slice({ title: "Cycle B", dependsOn: [2] }),
    ];
    const file = writeGraph(42, plan);

    expect(() => runPublishIssueGraphCli([file], fake.gh)).toThrow(/dependency cycle detected/);
    expect(fake.calls).toHaveLength(0);
  });

  test("#603.3: a criterion with no check: marker exits nonzero, naming the slice position and the rule, with zero gh calls", () => {
    const fake = createFakeGh();
    const plan = [slice({ title: "No marker", acceptanceCriteria: ["Just prose, no marker at all"] })];
    const file = writeGraph(42, plan);

    expect(() => runPublishIssueGraphCli([file], fake.gh)).toThrow(/slice 1 \("No marker"\).*check/);
    expect(fake.calls).toHaveLength(0);
  });

  test("#603.4: two slices with no edge between them whose filesClaimed overlap are published, with one stderr line naming both positions and the overlapping path", () => {
    const fake = createFakeGh();
    const plan = [
      slice({ title: "First", filesClaimed: ["bin/shared.ts"] }),
      slice({ title: "Second", filesClaimed: ["bin/shared.ts"] }),
    ];
    const file = writeGraph(42, plan);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    runPublishIssueGraphCli([file], fake.gh);

    expect(issueCreateCalls(fake.calls)).toHaveLength(2);

    const overlapLines = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("bin/shared.ts"));
    expect(overlapLines).toHaveLength(1);
    expect(overlapLines[0]).toContain("1");
    expect(overlapLines[0]).toContain("2");
  });

  test("#613.6: runPublishIssueGraphCli publishes through a Tracker built by trackerMemory, with no callable GhExec anywhere in its dependencies", () => {
    const createdIssues: CreateIssueInput[] = [];
    const tracker = trackerMemory({ firstIssueNumber: 999, issueIds: { 1000: 555000 }, createdIssues });
    const plan = [slice({ title: "Root" })];
    const file = writeGraph(42, plan);

    const table = runPublishIssueGraphCli([file], tracker as unknown as GhExec);

    expect(createdIssues).toHaveLength(1);
    expect(createdIssues[0].title).toBe("Root");
    const rootRow = table.split("\n").find((line) => line.includes("Root"));
    expect(rootRow).toContain("1");
    expect(rootRow).toContain("1000");
  });
});
