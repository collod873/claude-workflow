import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { git, scratch } from "./scenarios.ts";
import { hireIn } from "./stage.ts";

const SPENT = "sk-spent";
const FRESH = "sk-fresh";

const CLAUDE = `#!/bin/bash
cat >/dev/null
printf '%s\\n' "$CLAUDE_CODE_OAUTH_TOKEN" >>"$ACCOUNTS_TRIED"
sleep 0.3
if [ "$CLAUDE_CODE_OAUTH_TOKEN" = ${SPENT} ]; then
  printf '{"type":"assistant","error":"%s","message":{"role":"assistant","content":[]}}\\n' "$SPENT_ERROR"
  jq -cn --arg said "$SPENT_SAYS" '{type:"result",subtype:"success",is_error:true,result:$said}'
  exit 1
fi
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"session_id":"sess","result":"reviewed"}'
`;

function spentThenFresh(error: string, said: string) {
  const root = scratch("stage-accounts-");
  const tree = join(root, "tree");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(tree);
  git(tree, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(root, "bin", "claude"), CLAUDE);
  chmodSync(join(root, "bin", "claude"), 0o755);
  vi.stubEnv("PATH", `${join(root, "bin")}:${process.env.PATH}`);
  vi.stubEnv("STAGE_MINUTES", undefined);
  vi.stubEnv("TREE_PATH", undefined);
  vi.stubEnv("ACCOUNTS_TRIED", join(root, "accounts"));
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", SPENT);
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN_2", FRESH);
  vi.stubEnv("SPENT_ERROR", error);
  vi.stubEnv("SPENT_SAYS", said);
  process.chdir(tree);
  return { root, tree };
}

const startedIn = process.cwd();
afterEach(() => {
  process.chdir(startedIn);
  vi.unstubAllEnvs();
});

describe("account failover across hires running at once", () => {
  it("moves every hire that ended on a spent account to the fresh one, where a sibling moving first left the others red (#2749)", async () => {
    const { root, tree } = spentThenFresh("rate_limit", "You've hit your weekly limit · resets 5pm (America/New_York)");
    const reviewers = ["974-1", "974-2", "974-3"].map((seat) => hireIn(tree, "finish", seat, { name: "reviewer", model: "opus", effort: "medium" }));

    const spent = await Promise.all(reviewers.map((spend) => spend("review it")));

    expect(spent.map(({ refusal }) => refusal)).toEqual([undefined, undefined, undefined]);
    const tried = readFileSync(join(root, "accounts"), "utf8").split("\n").filter(Boolean);
    expect(tried.filter((token) => token === FRESH)).toHaveLength(3);
  });

  it.each([
    ["the weekly wording", "unknown", "You've hit your weekly limit · resets 5pm (America/New_York)"],
    ["the 5-hour wording (#1766)", "unknown", "You've hit your 5-hour limit · resets 4:20am (America/New_York)"],
    ["a rate_limit error in the stream whatever its wording (#1766)", "rate_limit", "Some wording no regex knows yet"],
  ])("launches next on the second account after the first ends on %s", async (_, error, said) => {
    const { root, tree } = spentThenFresh(error, said);
    vi.resetModules();
    const { hireIn: freshHireIn } = await import("./stage.ts");
    const spend = freshHireIn(tree, "build", `1766-${error}-${said.length}`, { name: "builder", model: "opus", effort: "medium" });

    const spent = await spend("build it");

    expect(spent.refusal).toBeUndefined();
    expect(readFileSync(join(root, "accounts"), "utf8").split("\n").filter(Boolean)).toEqual([SPENT, FRESH]);
  });
});
