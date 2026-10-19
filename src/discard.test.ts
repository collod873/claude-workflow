import { describe, expect, it } from "vitest";
import { discards } from "./discard.ts";
import { fileDiff } from "./reviewer.part.ts";

describe("discards names each added gh, git or bin/mark call whose error is thrown away, by file and line (#1080)", () => {
  it("names the file and line of a gh call that sends its stderr to /dev/null, and nothing when the gh call keeps its stderr", () => {
    const thrown = `${fileDiff("bin/close", 'gh pr view "$pr" --json body 2>/dev/null')}`.replace("@@ -0,0 +1 @@\n", "@@ -10,2 +10,3 @@\n set -u\n-old\n+kept\n");

    expect(discards(thrown)).toEqual(["bin/close:12 sends a gh call's stderr to /dev/null"]);
    expect(discards(fileDiff("bin/close", 'gh pr view "$pr" --json body'))).toEqual([]);
  });

  it("names a git call ending in || true and a gh spawn with stderr ignore, and quotes the why a quiet: comment gives", () => {
    const diff = [
      fileDiff("bin/land", "git fetch origin main || true"),
      fileDiff("src/close.ts", "spawnSync(\"gh\", [\"label\", \"create\", name], { stdio: [\"ignore\", \"pipe\", \"ignore\"] });"),
      fileDiff("bin/mark", "gh label create landing 2>/dev/null # quiet: the label already exists on every repo after the first run"),
      fileDiff("src/count.ts", "const total = lines.length || true;"),
    ].join("");

    expect(discards(diff)).toEqual([
      "bin/land:1 puts || true on a git call",
      "src/close.ts:1 spawns a gh call with its stderr ignored",
      'bin/mark:1 sends a gh call\'s stderr to /dev/null, quiet: "the label already exists on every repo after the first run"',
    ]);
  });

  it("reads a call wrapped over several added lines, a shell call continued with a backslash and a spawn whose stdio sits on its own line, and a single-quoted stdio", () => {
    const wrapped = [
      'gh pr view "$pr" \\',
      "  --json body \\",
      "  --jq .body 2>/dev/null",
      "const listed = spawnSync(",
      '  "git",',
      '  ["ls-files"],',
      '  { stdio: ["ignore", "pipe", "ignore"] },',
      ");",
      "spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' });",
      'gh pr view "$pr"',
      "count=$((count + 1)) || true",
    ].join("\n+");

    expect(discards(fileDiff("bin/close", wrapped).replace("@@ -0,0 +1 @@", "@@ -0,0 +1,11 @@"))).toEqual([
      "bin/close:1 sends a gh call's stderr to /dev/null",
      "bin/close:4 spawns a git call with its stderr ignored",
      "bin/close:9 spawns a gh call with its stderr ignored",
    ]);
  });

  it("does not join added lines across a bracket inside a string or a comment, so each discard is named on its own line (#1088)", () => {
    const stray = [
      'echo "usage: close (pr"',
      "gh pr view 1 2>/dev/null",
      "# pick the label [first",
      "git fetch origin || true",
      'const open = "(";',
      "spawnSync('gh', ['auth'], { stdio: 'ignore' }); // close ]",
      "bin/mark 9 building || true",
    ].join("\n+");

    expect(discards(fileDiff("bin/close", stray).replace("@@ -0,0 +1 @@", "@@ -0,0 +1,7 @@"))).toEqual([
      "bin/close:2 sends a gh call's stderr to /dev/null",
      "bin/close:4 puts || true on a git call",
      "bin/close:6 spawns a gh call with its stderr ignored",
      "bin/close:7 puts || true on a bin/mark call",
    ]);
  });
});
