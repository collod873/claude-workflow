import { describe, expect, it } from "vitest";
import { SeamManifest } from "./schema";

describe("SeamManifest", () => {
  it("accepts an empty manifest", () => {
    expect(SeamManifest.safeParse([]).success).toBe(true);
  });

  it("accepts well-formed one-line entries", () => {
    const result = SeamManifest.safeParse([
      "`GhExec`: an injected `(args: string[]) => string` executor, at shared/gh.ts, consumed by the publisher.",
    ]);

    expect(result.success).toBe(true);
  });

  it("rejects a manifest entry containing a newline", () => {
    const result = SeamManifest.safeParse(["line one\nline two"]);

    expect(result.success).toBe(false);
  });

  it("rejects an empty-string entry", () => {
    const result = SeamManifest.safeParse([""]);

    expect(result.success).toBe(false);
  });
});
