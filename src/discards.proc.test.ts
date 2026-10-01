import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const DISCARD = /2>\s*\/dev\/null|&>\s*\/dev\/null|>\s*\/dev\/null\s+2>&1|\|\|\s*(true|:)\s*($|#)/;
const MACHINE_CALL = /(^|[\s;|&(`$])(gh|git|bin\/mark)\s/;
const QUIET = /#\s*quiet:\s*\S/;

function discardsIn(source: string): string[] {
  return source.split("\n").filter((line) => DISCARD.test(line.replace(QUIET, "")) && MACHINE_CALL.test(line) && !QUIET.test(line));
}

function machineFiles(): string[] {
  return git(REPO, "ls-files", "-z", "bin", ".github")
    .split("\0")
    .filter((path) => path.startsWith("bin/") || /\.ya?ml$/.test(path));
}

describe("every gh, git or bin/mark call that throws its error away says why that failure is the expected answer, so a run's log never hides a real one (#1081)", () => {
  it("finds a discard on each machine call and lets one through that says quiet", () => {
    expect(discardsIn('gh label create "$name" >/dev/null 2>&1\n')).toHaveLength(1);
    expect(discardsIn("state=$(gh pr view x --json state 2>/dev/null)\n")).toHaveLength(1);
    expect(discardsIn("  bin/mark 9 building || true\n")).toHaveLength(1);
    expect(discardsIn("git -C x status --porcelain &>/dev/null\n")).toHaveLength(1);
    expect(discardsIn("gh label create x >/dev/null 2>&1 # quiet: the label already exists\n")).toHaveLength(0);
    expect(discardsIn('tail -F x 2>/dev/null | jq .\nsaid=$(gh api x 2>&1 >/dev/null) || failed\n')).toHaveLength(0);
  });

  it("holds at none across bin/ and the workflows", () => {
    const files = machineFiles();
    const found = files.flatMap((path) => discardsIn(readFileSync(join(REPO, path), "utf8")).map((line) => `${path}: ${line.trim()}`));

    expect(files).toEqual(expect.arrayContaining(["bin/mark", ".github/workflows/build.yml"]));
    expect(found, `say why with a trailing # quiet: comment, or let the error reach the log:\n${found.join("\n")}`).toEqual([]);
  });
});
