import { describe, expect, it } from "vitest";
import type { StageExec } from "../shared/stage";
import { refusalNamesReason, runRefuter, survivesRefutation, type RefuterVerdict } from "./refuter";
import type { Finding } from "./structural-refusal";

const DIFF = `diff --git a/src/widget.ts b/src/widget.ts
@@ -10,3 +10,4 @@ src/widget.ts:12
+export function widget() {
+  return undefined;
+}
`;

describe("refusalNamesReason", () => {
  it("is false for a reason naming no gate and no path:line", () => {
    expect(refusalNamesReason("this finding is not worth the owner's time", [])).toBe(false);
    expect(refusalNamesReason("", ["no-unused-vars"])).toBe(false);
  });

  it("is true for a reason citing a path:line", () => {
    expect(refusalNamesReason("src/widget.ts:12 is already guarded two lines up", [])).toBe(true);
  });

  it("is true for a reason naming a check greenGateChecks already lists", () => {
    expect(refusalNamesReason("no-unused-vars already covers this", ["no-unused-vars"])).toBe(true);
  });
});

function verdict(over: Partial<RefuterVerdict> = {}): RefuterVerdict {
  return { refuted: false, reason: "", ...over };
}

describe("survivesRefutation", () => {
  it("survives an unrefused verdict, whatever the reason field carries", () => {
    expect(survivesRefutation(verdict({ refuted: false, reason: "" }), [])).toBe(true);
  });

  it("does not survive a refusal naming a checkable path:line", () => {
    const refused = verdict({ refuted: true, reason: "src/widget.ts:12 returns the right thing" });
    expect(survivesRefutation(refused, [])).toBe(false);
  });

  it("does not survive a refusal naming a check a green gate already lists", () => {
    const refused = verdict({ refuted: true, reason: "no-unused-vars already covers this" });
    expect(survivesRefutation(refused, ["no-unused-vars"])).toBe(false);
  });

  it("survives a refusal that names no gate, path, or rule — ADR-0035's mechanical strip", () => {
    const hedging = verdict({ refuted: true, reason: "I'm not confident this is worth flagging." });
    expect(survivesRefutation(hedging, ["no-unused-vars"])).toBe(true);
  });

  it("survives a refusal with an empty reason", () => {
    expect(survivesRefutation(verdict({ refuted: true, reason: "" }), [])).toBe(true);
  });
});

/** A `StageExec` stand-in that answers with a canned verdict per call and records every prompt it saw. */
function fakeExec(answers: RefuterVerdict[]): { exec: StageExec; prompts: string[] } {
  const prompts: string[] = [];
  let call = 0;
  const exec: StageExec = async (_argv, stdin) => {
    prompts.push(stdin ?? "");
    const answer = answers[call] ?? answers[answers.length - 1];
    call += 1;
    return JSON.stringify(answer);
  };
  return { exec, prompts };
}

describe("runRefuter", () => {
  const survivor: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };
  const another: Finding = { message: "src/widget.ts:12 also never checks for null" };

  it("makes exactly one refuter call per finding", async () => {
    const fake = fakeExec([verdict({ refuted: false, reason: "" }), verdict({ refuted: false, reason: "" })]);

    await runRefuter(fake.exec, [survivor, another], DIFF, []);

    expect(fake.prompts.length).toBe(2);
  });

  it("keeps a finding a checkable refusal did not name a reason for", async () => {
    const fake = fakeExec([verdict({ refuted: true, reason: "not important" })]);

    const survivors = await runRefuter(fake.exec, [survivor], DIFF, []);

    expect(survivors).toEqual([survivor]);
  });

  it("drops a finding a refusal named a real reason for", async () => {
    const fake = fakeExec([verdict({ refuted: true, reason: "src/widget.ts:12 is already handled above" })]);

    const survivors = await runRefuter(fake.exec, [survivor], DIFF, []);

    expect(survivors).toEqual([]);
  });

  it("keeps only the survivors out of a mixed batch, in order", async () => {
    const fake = fakeExec([
      verdict({ refuted: false, reason: "" }),
      verdict({ refuted: true, reason: "src/widget.ts:12 already handled" }),
    ]);

    const survivors = await runRefuter(fake.exec, [survivor, another], DIFF, []);

    expect(survivors).toEqual([survivor]);
  });

  it("substitutes the finding and diff into the prompt sent to the model", async () => {
    const fake = fakeExec([verdict({ refuted: false, reason: "" })]);

    await runRefuter(fake.exec, [survivor], DIFF, []);

    expect(fake.prompts[0]).toContain(survivor.message);
    expect(fake.prompts[0]).toContain("src/widget.ts");
  });
});
