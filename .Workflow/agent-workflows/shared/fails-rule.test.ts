import { describe, expect, it } from "vitest";
import { judgeFailsEdits } from "./fails-rule";

function diffOf(file: string, hunk: string[]): string {
  return [`--- a/${file}`, `+++ b/${file}`, "@@ -1,3 +1,3 @@", ...hunk].join("\n");
}

describe("judgeFailsEdits", () => {
  it("allows the one legal edit: dropping .fails so a red acceptance test turns green", () => {
    const diff = diffOf("lib/thing.test.ts", [
      ' describe("thing", () => {',
      '-  test.fails("#360: the gate is a constant", () => {',
      '+  test("#360: the gate is a constant", () => {',
      "     expect(gate()).toBe(120);",
    ]);

    expect(judgeFailsEdits(diff)).toEqual({ ok: true });
  });

  it("accepts it.fails as the same marker", () => {
    const diff = diffOf("lib/thing.test.ts", ['-  it.fails("#360: x", () => {', '+  it("#360: x", () => {']);

    expect(judgeFailsEdits(diff)).toEqual({ ok: true });
  });

  it("refuses a rewrite of the test's own line, even one that also drops .fails", () => {
    const diff = diffOf("lib/thing.test.ts", [
      '-  test.fails("#360: the gate is a constant", () => {',
      '+  test("#360: the gate is roughly a constant", () => {',
    ]);

    const verdict = judgeFailsEdits(diff);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("lib/thing.test.ts");
  });

  it("refuses deleting a test.fails test outright", () => {
    const diff = diffOf("lib/thing.test.ts", [
      '-  test.fails("#360: the gate is a constant", () => {',
      "-    expect(gate()).toBe(120);",
      "-  });",
    ]);

    expect(judgeFailsEdits(diff).ok).toBe(false);
  });

  it("allows adding a test.fails test, which is how the acceptance author lands one", () => {
    const diff = diffOf("lib/thing.test.ts", ['+  test.fails("#361: the next thing", () => {', "+    expect(1).toBe(2);", "+  });"]);

    expect(judgeFailsEdits(diff)).toEqual({ ok: true });
  });

  it("ignores edits to lines around a test.fails test, which are the implementer's to make", () => {
    const diff = diffOf("lib/thing.test.ts", [
      '   test.fails("#360: the gate is a constant", () => {',
      "-    expect(gate()).toBe(121);",
      "+    expect(gate()).toBe(120);",
    ]);

    expect(judgeFailsEdits(diff)).toEqual({ ok: true });
  });

  it("treats a rewrite on a declared path as not an offence", () => {
    const diff = diffOf("lib/thing.test.ts", [
      '-  test.fails("#360: the gate is a constant", () => {',
      '+  test("#360: the gate is roughly a constant", () => {',
    ]);

    expect(judgeFailsEdits(diff, new Set(["lib/thing.test.ts"]))).toEqual({ ok: true });
  });

  it("still refuses an undeclared file's rewrite even when another file is declared", () => {
    const diff = [
      diffOf("a.test.ts", ['-  test.fails("#1: a", () => {', '+  test("#1: a, reworded", () => {']),
      diffOf("b.test.ts", ['-  test.fails("#2: b", () => {', '+  test("#2: b, reworded", () => {']),
    ].join("\n");

    const verdict = judgeFailsEdits(diff, new Set(["a.test.ts"]));

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).not.toContain("a.test.ts:");
      expect(verdict.reason).toContain("b.test.ts");
    }
  });

  it("names every offending file when a diff touches several", () => {
    const diff = [
      diffOf("a.test.ts", ['-  test.fails("#1: a", () => {', "-  });"]),
      diffOf("b.test.ts", ['-  test.fails("#2: b", () => {', '+  test.fails("#2: b, reworded", () => {']),
    ].join("\n");

    const verdict = judgeFailsEdits(diff);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("2 acceptance test(s)");
      expect(verdict.reason).toContain("a.test.ts");
      expect(verdict.reason).toContain("b.test.ts");
    }
  });
});
