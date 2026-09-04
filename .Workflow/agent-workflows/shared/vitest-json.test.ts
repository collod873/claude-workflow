import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { scratchDir } from "./scratch.fixture";
import { runVitestJson, runVitestReport } from "./vitest-json";

test("a target with no vitest config of its own is refused rather than run", () => {
  const dir = scratchDir("no-config");

  const ran = runVitestReport(["."], dir);

  expect(ran).toEqual({ error: expect.stringContaining("no vitest config of its own") });
});

test("the refusal reaches a caller reading a run result", () => {
  const dir = scratchDir("no-config");

  expect(runVitestJson(".", dir)).toEqual({
    collected: false,
    collectionError: expect.stringContaining("climb out of it"),
    failures: [],
  });
});

test("a target carrying its own config is not refused", () => {
  const dir = scratchDir("own-config");
  writeFileSync(join(dir, "vitest.config.ts"), "export default {};\n");

  const ran = runVitestReport(["."], dir);

  expect(ran).not.toEqual({ error: expect.stringContaining("no vitest config of its own") });
});
