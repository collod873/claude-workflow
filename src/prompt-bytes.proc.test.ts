import { cpSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { capped } from "./brief.ts";
import { PROMPTS, sized, uncapped, unlaunched, unmeasured, type Prompt } from "./prompt-bytes.ts";
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

function measuredCopy(edits: Record<string, (source: string) => string>): string {
  const copy = scratch("prompt-bytes-");
  cpSync(join(REPO, "src"), join(copy, "src"), { recursive: true });
  cpSync(join(REPO, "vitest.config.ts"), join(copy, "vitest.config.ts"));
  symlinkSync(join(REPO, "node_modules"), join(copy, "node_modules"));
  for (const [file, edit] of Object.entries(edits)) writeFileSync(join(copy, file), edit(readFileSync(join(copy, file), "utf8")));
  return copy;
}

const sources = (copy: string) =>
  Object.fromEntries(readdirSync(join(copy, "src")).map((name) => [name, readFileSync(join(copy, "src", name), "utf8")]));

const GROWN = { "src/researcher.ts": (source: string) => source.replace("Your reading time is up.", `Your reading time is up. ${"More words. ".repeat(300)}`) };
const SHRUNK = { "src/researcher.ts": (source: string) => source.replace(" Read nothing more.", "") };
const LINE = /^prompt-bytes: \d+ prompts, (\d+) bytes of their own words, the largest the (.+) at (\d+)\n$/;

describe("every prompt's size is reported, never refused (#950)", () => {
  it("passes a prompt that grew past the size it had, naming the total and the largest", () => {
    const copy = measuredCopy(GROWN);
    const { status, stdout, stderr } = execute("node", copy, {}, ["src/prompt-bytes.ts"]);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const [, total, largest, bytes] = LINE.exec(stdout) ?? [];
    expect(largest).toBe("researcher out of time");
    expect(Number(bytes)).toBeGreaterThan(3000);
    expect(Number(total)).toBeGreaterThan(Number(bytes));
  });

  it("rewrites no source file, whatever size a prompt moves to", () => {
    for (const edits of [GROWN, SHRUNK]) {
      const copy = measuredCopy(edits);
      const before = sources(copy);
      expect(execute("node", copy, {}, ["src/prompt-bytes.ts"]).status).toBe(0);
      expect(sources(copy)).toEqual(before);
    }
  });

  it("sums the prompts' own words and names the largest", () => {
    expect(sized([terse("small", "x".repeat(5)), terse("big", "x".repeat(30))])).toBe(
      "prompt-bytes: 2 prompts, 35 bytes of their own words, the largest the big at 30",
    );
    expect(sized(PROMPTS)).toMatch(/^prompt-bytes: \d+ prompts, \d+ bytes of their own words, the largest the .+ at \d+$/);
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
    writeFileSync(join(copy, "src", "look-back.ts"), 'import { hired } from "./stage.ts";\n');
    writeFileSync(join(copy, "src", "stage.ts"), 'spawnSync("claude", argv);\n');
    expect(unmeasured(copy, PROMPTS)).toEqual([
      "src/judge.ts hires a model and no prompt of that name is measured",
      "src/look-back.ts hires a model and no prompt of that name is measured",
    ]);
  });

  it("refuses a model started anywhere but the stage launcher, the way the reviewer ran without hooks or a transcript on #840", () => {
    expect(unlaunched(REPO)).toEqual([]);

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
