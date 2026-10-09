import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capped } from "./brief.ts";
import { sized, uncapped, unlaunched, unmeasured, type Prompt } from "./prompt-bytes.ts";
import { scratch } from "./scenarios.ts";

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

describe("the prompts step sizes every prompt and refuses one it cannot bound (#950)", () => {
  it("sums the prompts' own words and names the largest", () => {
    expect(sized([terse("small", "x".repeat(5)), terse("big", "x".repeat(30))])).toBe(
      "prompt-bytes: 2 prompts, 35 bytes of their own words, the largest the big at 30",
    );
  });

  it("refuses a filled-in value with no cap, and passes a builder that caps what it pastes in", () => {
    expect(uncapped([terse("bounded", "x")])).toEqual([]);
    expect(uncapped([leaky("open", "x")])).toEqual([
      `the open prompt pastes pasted in with no cap: ${FILLER * 2 + 1} bytes, over ${FILLER}`,
    ]);
  });

  it("names a stage that hires a model whose prompt nothing measures", () => {
    const copy = scratch("prompt-hires-");
    mkdirSync(join(copy, "src"));
    writeFileSync(join(copy, "src", "judge.ts"), 'spawnSync("claude", argv);\n');
    writeFileSync(join(copy, "src", "quiet.ts"), 'spawnSync("gh", argv);\n');
    writeFileSync(join(copy, "src", "look-back.ts"), 'import { hired } from "./stage.ts";\n');
    writeFileSync(join(copy, "src", "stage.ts"), 'spawnSync("claude", argv);\n');
    expect(unmeasured(copy, [])).toEqual([
      "src/judge.ts hires a model and no prompt of that name is measured",
      "src/look-back.ts hires a model and no prompt of that name is measured",
    ]);
  });

  it("refuses a model started anywhere but the stage launcher, the way the reviewer ran without hooks or a transcript on #840", () => {
    const copy = scratch("prompt-launch-");
    mkdirSync(join(copy, "src"));
    writeFileSync(join(copy, "src", "judge.ts"), 'spawnSync("claude", argv);\n');
    writeFileSync(join(copy, "src", "look-back.ts"), 'import { hired } from "./stage.ts";\n');
    writeFileSync(join(copy, "src", "stage.ts"), 'spawnSync("claude", argv);\n');
    expect(unlaunched(copy)).toEqual([
      "src/judge.ts starts claude itself; hire through src/stage.ts so it gets the owner's hooks, a transcript and a time cap",
    ]);
  });
});
