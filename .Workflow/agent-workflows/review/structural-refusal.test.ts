import { expect, test } from "vitest";
import { isStructurallyRefused, type Finding } from "./structural-refusal";

const DIFF = `diff --git a/src/widget.ts b/src/widget.ts
@@ -10,3 +10,4 @@ src/widget.ts:12
+export function widget() {
+  return undefined;
+}
`;

type DiffOnlyRefusal = (finding: Finding, diff: string) => boolean;

test.fails(
  "#533.3: isStructurallyRefused takes the finding and the diff only, and still refuses a finding citing no path:line in the diff",
  () => {
    const refused = isStructurallyRefused as DiffOnlyRefusal;

    expect(refused({ message: "This function is confusing." }, DIFF)).toBe(true);
    expect(refused({ message: "src/widget.ts:40 is never reached" }, DIFF)).toBe(true);
    expect(refused({ message: "src/widget.ts:12 returns undefined on the empty-cart path" }, DIFF)).toBe(false);
    expect(isStructurallyRefused.length).toBe(2);
  },
);
