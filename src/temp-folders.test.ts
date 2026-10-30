import { readFileSync, globSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { RUN_TEMP_PREFIX } from "../vitest.config.ts";

const TEST_SIDE = ["src/*.test.ts", "src/*.part.ts", "src/scenarios.ts"];
const OWN_TEMP = /\bmkdtemp(Sync)?\(\s*join\(\s*tmpdir\(\)/;

describe("a test run's temp folders (claude-workflow#1530)", () => {
  it("sends every tmpdir() of the run into one folder the run removes, so a pass, a red or an interrupted run leaves nothing in /tmp", () => {
    expect(basename(tmpdir()).startsWith(RUN_TEMP_PREFIX)).toBe(true);
    expect(dirname(tmpdir())).not.toBe(tmpdir());
  });

  it("refuses a test that makes a temp folder anywhere but under tmpdir(), which would escape the run's folder", () => {
    const strays = globSync(TEST_SIDE, { cwd: dirname(import.meta.dirname) }).flatMap((file) =>
      readFileSync(`${dirname(import.meta.dirname)}/${file}`, "utf8")
        .split("\n")
        .flatMap((line, at) => ((/\bmkdtemp(Sync)?\(/.test(line) && !OWN_TEMP.test(line)) || /["'`]\/tmp\//.test(line) ? [`${file}:${at + 1}`] : [])),
    );
    expect(strays).toEqual([]);
  });
});
