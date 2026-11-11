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
  printf '%s\\n' '{"type":"result","subtype":"success","is_error":true,"result":"You\\u0027ve hit your weekly limit · resets 5pm (America/New_York)"}'
  exit 1
fi
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"session_id":"sess","result":"reviewed"}'
`;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("account failover across hires running at once", () => {
  it("moves every hire that ended on a spent account to the fresh one, where a sibling moving first left the others red (#2749)", async () => {
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
    const cwd = process.cwd();
    process.chdir(tree);
    try {
      const reviewers = ["spec-1", "spec-2", "spec-3"].map((seat) => hireIn(tree, "finish", seat, { name: "reviewer on the spec", model: "opus", effort: "medium" }));

      const spent = await Promise.all(reviewers.map((spend) => spend("review it")));

      expect(spent.map(({ refusal }) => refusal)).toEqual([undefined, undefined, undefined]);
      const tried = readFileSync(join(root, "accounts"), "utf8").split("\n").filter(Boolean);
      expect(tried.filter((token) => token === FRESH)).toHaveLength(3);
    } finally {
      process.chdir(cwd);
    }
  });
});
