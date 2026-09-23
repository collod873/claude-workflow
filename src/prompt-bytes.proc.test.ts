import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { capped } from "./brief.ts";
import { CEILINGS, PROMPTS, grown, record, shrunk, uncapped, unmeasured, type Prompt } from "./prompt-bytes.ts";
import { execute, scratch } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const FILLER = 200;

function planted(name: string, words: string, fill: (filler: string) => string): Prompt {
  return {
    name,
    file: `src/${name}.ts`,
    cap: FILLER,
    slots: ["pasted"],
    build: (filled) => `${words}${fill(filled.pasted ?? "")}`,
  };
}

const terse = (name: string, words: string) => planted(name, words, (filler) => capped(filler, 20));
const leaky = (name: string, words: string) => planted(name, words, (filler) => filler);

describe("every prompt holds a byte ceiling that only ever shrinks (#663)", () => {
  it("writes no more of its own words than the ceiling recorded for it, with nothing left unpaid", () => {
    expect(grown(PROMPTS, CEILINGS)).toEqual([]);
    expect(shrunk(PROMPTS, CEILINGS)).toEqual(CEILINGS);
  });

  it("refuses a prompt grown past its ceiling and records the smaller number when one shrinks", () => {
    expect(grown([terse("wordy", "x".repeat(30))], { wordy: 20 })).toEqual([
      "the wordy prompt writes 30 bytes of its own words, over its ceiling of 20",
    ]);
    expect(grown([terse("kept", "x".repeat(20))], { kept: 20 })).toEqual([]);
    expect(grown([terse("stranger", "x")], {})).toEqual(["the stranger prompt has no recorded ceiling"]);

    expect(shrunk([terse("cut", "x".repeat(5))], { cut: 20 })).toEqual({ cut: 5 });
    expect(shrunk([terse("kept", "x".repeat(20))], { kept: 20 })).toEqual({ kept: 20 });

    const copy = join(scratch("prompt-bytes-"), "prompt-bytes.ts");
    copyFileSync(join(REPO, "src", "prompt-bytes.ts"), copy);
    record(copy, { brief: 12, "test author": 34 });
    expect(readFileSync(copy, "utf8")).toContain('CEILINGS: Record<string, number> = { "brief": 12, "test author": 34 };');
  });

  it("refuses a filled-in value with no cap, and passes a builder that caps what it pastes in", () => {
    expect(uncapped(PROMPTS)).toEqual([]);
    expect(uncapped([terse("bounded", "x")])).toEqual([]);
    expect(uncapped([leaky("open", "x")])).toEqual([
      `the open prompt pastes pasted in with no cap: ${FILLER * 2 + 1} bytes, over ${FILLER}`,
    ]);
  });

  it("names a stage that hires a model whose prompt nothing measures", () => {
    expect(unmeasured(REPO, PROMPTS)).toEqual([]);

    const copy = scratch("prompt-hires-");
    mkdirSync(join(copy, "src"));
    writeFileSync(join(copy, "src", "judge.ts"), 'spawnSync("claude", argv);\n');
    writeFileSync(join(copy, "src", "quiet.ts"), 'spawnSync("gh", argv);\n');
    writeFileSync(join(copy, "src", "fixer.ts"), 'import { runStage } from "./stage.ts";\n');
    writeFileSync(join(copy, "src", "stage.ts"), 'spawnSync("claude", argv);\n');
    expect(unmeasured(copy, PROMPTS)).toEqual([
      "src/fixer.ts hires a model and no prompt of that name is measured",
      "src/judge.ts hires a model and no prompt of that name is measured",
    ]);
  });
});
