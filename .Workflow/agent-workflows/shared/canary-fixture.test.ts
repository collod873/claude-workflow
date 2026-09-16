import { describe, expect, it } from "vitest";
import { collectSheetContext } from "../spec/collectors/sheet";
import { invocationFromEnv } from "../spec/spec";
import { fixtureFor } from "./canary-fixture.ts";
import { planFire } from "./canary-fire-plan.ts";
import { test } from "vitest";
import { trackerMemory } from "./tracker-memory";

describe("fixtureFor", () => {
  it("has nothing to say about a lane whose fire carries no issue", () => {
    expect(fixtureFor("verify")).toBeUndefined();
    expect(fixtureFor("back-stamp")).toBeUndefined();
  });

  it("seeds the spec lane, whose repository_dispatch fire arrives with an issue number in it", () => {
    expect(planFire("spec")).toMatchObject({ kind: "repository_dispatch" });
    expect(fixtureFor("spec")).toBeDefined();
  });

  it("satisfies the collector the spec lane actually runs on a sheet-accepted fire", () => {
    const seeded = fixtureFor("spec")!;
    const tracker = trackerMemory({ issues: { 1: { body: seeded.body, comments: seeded.comments } } });

    const { context, decisions } = collectSheetContext(tracker, 1);

    expect(context.ownerWords).toBe(seeded.body);
    expect(context.boundaries).toContain("short");
    expect(decisions.length).toBeGreaterThan(0);
  });

  it("names every label its seeding will add, so no gh call fails on a label that does not exist", () => {
    const seeded = fixtureFor("spec")!;

    expect(seeded.ensureLabels).toContain(seeded.label);
    expect(seeded.ensureLabels).toContain("prd");
    expect(seeded.ensureLabels).toContain("sliceable");
  });

  it("carries an issue number the lane will accept, which is what the fixture exists to supply", () => {
    expect(() => invocationFromEnv({ SPEC_TRIGGER: "to-spec", ISSUE_NUMBER: "" })).toThrow();
    expect(invocationFromEnv({ SPEC_TRIGGER: "to-spec", ISSUE_NUMBER: "7" })).toEqual({
      trigger: "to-spec",
      issueNumber: 7,
    });
  });
});

test("#616.4: satisfies the collector reading the sheet-accepted fire through a Tracker built from trackerMemory", () => {
  const seeded = fixtureFor("spec")!;
  const tracker = trackerMemory({ issues: { 1: { body: seeded.body, comments: seeded.comments } } });

  const { context, decisions } = collectSheetContext(tracker as unknown as Parameters<typeof collectSheetContext>[0], 1);

  expect(context.ownerWords).toBe(seeded.body);
  expect(context.boundaries).toContain("short");
  expect(decisions.length).toBeGreaterThan(0);
});
