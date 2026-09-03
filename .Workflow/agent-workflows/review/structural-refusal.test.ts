import { describe, expect, it } from "vitest";
import { PATH_LINE_RE } from "../shared/ticket-shape";
import type { Finding } from "./structural-refusal";
import { isStructurallyRefused } from "./structural-refusal";

const DIFF = `diff --git a/src/widget.ts b/src/widget.ts
@@ -10,3 +10,4 @@ src/widget.ts:12
+export function widget() {
+  return undefined;
+}
`;

function finding(over: Partial<Finding> = {}): Finding {
  return { message: "src/widget.ts:12 returns undefined on the empty-cart path", ...over };
}

describe("isStructurallyRefused", () => {
  it("refuses a finding that names no path:line at all", () => {
    expect(isStructurallyRefused(finding({ message: "This function is confusing." }), DIFF, [])).toBe(
      true,
    );
  });

  it("refuses a finding whose cited path:line is not in the diff under review", () => {
    const stale = finding({ message: "src/other.ts:99 has the same bug" });

    expect(isStructurallyRefused(stale, DIFF, [])).toBe(true);
  });

  it("refuses a finding that restates a check a green gate already enforces", () => {
    const restates = finding({
      message: "src/widget.ts:12 violates no-unused-vars, which eslint already flags",
    });

    expect(isStructurallyRefused(restates, DIFF, ["no-unused-vars"])).toBe(true);
  });

  it("refuses on the green-check condition alone, even with no path:line", () => {
    const restates = finding({ message: "This just restates the acceptance criterion already met" });

    expect(
      isStructurallyRefused(restates, DIFF, ["the acceptance criterion already met"]),
    ).toBe(true);
  });

  it("survives neither condition and reaches the refuter", () => {
    const survivor = finding();

    expect(isStructurallyRefused(survivor, DIFF, ["no-unused-vars"])).toBe(false);
  });

  it("reuses shared/ticket-shape's PATH_LINE_RE rather than a local copy", () => {
    expect(PATH_LINE_RE.test("src/widget.ts:12")).toBe(true);
  });
});
