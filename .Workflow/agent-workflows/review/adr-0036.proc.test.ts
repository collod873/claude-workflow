import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

const ADR = "docs/adr/0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md";

function adrText(): string {
  return execFileSync("cat", [ADR], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).toLowerCase();
}

test(
  "#533.5: ADR-0036 states the green-gate half was never wired and is deleted, describing only the diff-citation filter that remains",
  () => {
    const text = adrText();

    expect(text).toMatch(/never/);
    expect(text).toMatch(/delet/);
    expect(text).toMatch(/diff/);
  },
);
