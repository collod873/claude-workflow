import { describe, expect, it } from "vitest";
import { collectSheetContext } from "../spec/collectors/sheet";
import { fakeSheetGh } from "../spec/collectors/sheet-gh.fixture";
import { invocationFromEnv } from "../spec/spec";
import { fixtureFor } from "./canary-fixture.ts";
import { planFire } from "./canary-fire-plan.ts";

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
    const gh = fakeSheetGh(seeded.body, seeded.comments);

    const { context, decisions } = collectSheetContext(gh, 1);

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
