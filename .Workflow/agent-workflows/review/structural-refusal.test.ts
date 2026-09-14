import { describe, expect, it, test } from "vitest";
import { PATH_LINE_RE } from "../shared/ticket-shape";
import { isStructurallyRefused, type Finding } from "./structural-refusal";

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
    expect(isStructurallyRefused(finding({ message: "This function is confusing." }), DIFF)).toBe(true);
  });

  it("refuses a finding whose cited path:line is not in the diff under review", () => {
    expect(isStructurallyRefused(finding({ message: "src/other.ts:99 has the same bug" }), DIFF)).toBe(true);
  });

  it("survives and reaches the refuter when its path:line is in the diff", () => {
    expect(isStructurallyRefused(finding(), DIFF)).toBe(false);
  });

  it("reuses shared/ticket-shape's PATH_LINE_RE rather than a local copy", () => {
    expect(PATH_LINE_RE.test("src/widget.ts:12")).toBe(true);
  });
});

type DiffOnlyRefusal = (finding: Finding, diff: string) => boolean;

test(
  "#533.3: isStructurallyRefused takes the finding and the diff only, and still refuses a finding citing no path:line in the diff",
  () => {
    const refused = isStructurallyRefused as DiffOnlyRefusal;

    expect(refused({ message: "This function is confusing." }, DIFF)).toBe(true);
    expect(refused({ message: "src/widget.ts:40 is never reached" }, DIFF)).toBe(true);
    expect(refused({ message: "src/widget.ts:12 returns undefined on the empty-cart path" }, DIFF)).toBe(false);
    expect(isStructurallyRefused.length).toBe(2);
  },
);
