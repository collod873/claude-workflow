import { describe, expect, it } from "vitest";
import { DENIED, deniedBy, denyFlags, stageRefusals } from "./deny-list.ts";
import { LINE_LIMIT } from "./post.ts";

const REFUSED = [
  "npm test",
  "npm test -- core",
  "npm run check",
  "npm run lint",
  "npx vitest",
  "npx vitest run",
  "npx vitest run --config vitest.config.ts",
  "bin/check",
  "./bin/check",
  "git checkout main",
  "git switch -c ticket/723",
  "git reset --hard HEAD~1",
  "git rebase origin/main",
  "git stash",
  "git clean -fd",
  "git commit -m done",
  "git push origin ticket/723",
  "gh pr merge 723",
  "gh issue close 723",
  "gh api repos/collod873/claude-workflow/issues",
];

const LEFT = [
  "npx vitest run --config vitest.config.ts test-author",
  "git status --short",
  "git diff origin/main",
  "node src/test-author.ts 723",
  "bin/check static",
  "ls core",
];

describe("one deny list every stage reads (#663)", () => {
  it.each(REFUSED)("refuses %s", (command) => {
    expect(deniedBy("Bash", command)).toBeDefined();
  });

  it.each(LEFT)("leaves %s for the stage to run", (command) => {
    expect(deniedBy("Bash", command)).toBeUndefined();
  });

  it("refuses the web and the agents a stage would explore with, and leaves it what it writes tests with", () => {
    for (const tool of ["WebFetch", "WebSearch", "Agent", "Task"]) expect(deniedBy(tool)).toBeDefined();
    for (const tool of ["Read", "Edit", "Write"]) expect(deniedBy(tool)).toBeUndefined();
  });

  it("refuses a stage built without it, naming what that stage lets through", () => {
    expect(stageRefusals("planted", denyFlags())).toEqual([]);
    expect(stageRefusals("planted", ["--allowedTools", "Read,Edit,Write"])).toEqual([
      expect.stringContaining(`planted is built without the shared deny list: it lets through ${DENIED.length} of ${DENIED.length}`),
    ]);
    expect(stageRefusals("planted", ["--disallowedTools", DENIED.slice(0, -1).join(",")])).toEqual([
      expect.stringContaining(DENIED[DENIED.length - 1]),
    ]);
  });

  it("says its refusal in one line whatever the stage left out", () => {
    const said = stageRefusals("planted", []);

    expect(said).toHaveLength(1);
    expect(said[0].length).toBeLessThanOrEqual(LINE_LIMIT);
  });
});
