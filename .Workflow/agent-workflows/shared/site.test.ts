import { describe, expect, it } from "vitest";
import { isBareSite, normalizeSite, sitePath } from "./site";

const FIRST_AUDIT_SITES = [
  ".Workflow/agent-workflows/capture/backfill.ts:212 (isScratchProject)",
  ".Workflow/agent-workflows/shared/spine.ts (module header note on assistant turns, ~line 33; buildCaptureMarkdown)",
  ".Workflow/agent-workflows/shared/spine.ts (quoted/bulleted functions, ~line 233)",
  ".Workflow/agent-workflows/capture/backfill.ts (main(), summary console.log)",
] as const;

describe("sitePath", () => {
  it("resolves every site the first real audit wrote to the file it actually names", () => {
    expect(FIRST_AUDIT_SITES.map(sitePath)).toEqual([
      ".Workflow/agent-workflows/capture/backfill.ts",
      ".Workflow/agent-workflows/shared/spine.ts",
      ".Workflow/agent-workflows/shared/spine.ts",
      ".Workflow/agent-workflows/capture/backfill.ts",
    ]);
  });

  it("strips a trailing line number and leaves a path without one alone", () => {
    expect(sitePath("a.ts:10")).toBe("a.ts");
    expect(sitePath("a.ts")).toBe("a.ts");
  });

  it("leaves a colon that isn't a line number as part of the path", () => {
    expect(sitePath("weird:name.ts")).toBe("weird:name.ts");
  });
});

describe("normalizeSite", () => {
  it("keeps the line number while dropping everything after the path", () => {
    expect(normalizeSite(".Workflow/x.ts:212 (isScratchProject)")).toBe(".Workflow/x.ts:212");
  });

  it("is idempotent, so a note rewritten every run does not drift", () => {
    for (const site of FIRST_AUDIT_SITES) {
      expect(normalizeSite(normalizeSite(site))).toBe(normalizeSite(site));
    }
  });

  it("yields nothing for text carrying no site at all", () => {
    expect(normalizeSite("   ")).toBe("");
  });
});

describe("isBareSite", () => {
  it("refuses every site the first real audit wrote, the contract they broke", () => {
    for (const site of FIRST_AUDIT_SITES) expect(isBareSite(site)).toBe(false);
  });

  it("accepts a path with and without a line number", () => {
    expect(isBareSite("a.ts:10")).toBe(true);
    expect(isBareSite("a.ts")).toBe(true);
  });
});
