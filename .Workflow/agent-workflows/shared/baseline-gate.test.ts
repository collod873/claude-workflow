import { describe, expect, it } from "vitest";
import { compareBaseline, formatDelta, isMainModule, type Delta } from "./baseline-gate";

interface Item {
  id: string;
}

describe("compareBaseline", () => {
  const identity = (item: Item) => item.id;

  it("reports nothing added and nothing resolved when baseline and fresh agree", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(compareBaseline(items, items, identity)).toEqual({ added: [], resolved: [] });
  });

  it("reports a fresh item absent from the baseline as added", () => {
    const delta = compareBaseline([{ id: "a" }], [{ id: "a" }, { id: "b" }], identity);
    expect(delta.added).toEqual([{ id: "b" }]);
    expect(delta.resolved).toEqual([]);
  });

  it("reports a baseline item absent from fresh as resolved", () => {
    const delta = compareBaseline([{ id: "a" }, { id: "b" }], [{ id: "a" }], identity);
    expect(delta.added).toEqual([]);
    expect(delta.resolved).toEqual([{ id: "b" }]);
  });
});

describe("formatDelta", () => {
  const wording = {
    describeItem: (item: Item) => `  ${item.id}`,
    addedHeader: (count: number) => [`${count} added`],
    resolvedHeader: (count: number) => [`${count} resolved`],
    updateScriptPath: "shared/some-gate.ts",
  };

  it("returns undefined when both lists are empty — a clean run prints nothing", () => {
    const delta: Delta<Item> = { added: [], resolved: [] };
    expect(formatDelta(delta, wording)).toBeUndefined();
  });

  it("lists each added item under the added header", () => {
    const delta: Delta<Item> = { added: [{ id: "x" }], resolved: [] };
    const message = formatDelta(delta, wording);
    expect(message).toContain("1 added");
    expect(message).toContain("  x");
    expect(message).not.toContain("resolved");
  });

  it("lists each resolved item and names the update command", () => {
    const delta: Delta<Item> = { added: [], resolved: [{ id: "y" }] };
    const message = formatDelta(delta, wording);
    expect(message).toContain("1 resolved");
    expect(message).toContain("  y");
    expect(message).toContain("node shared/some-gate.ts update <root>");
  });
});

describe("isMainModule", () => {
  it("is false for a URL that isn't the process's own entry point", () => {
    expect(isMainModule("file:///not/the/entry/point.ts")).toBe(false);
  });
});
