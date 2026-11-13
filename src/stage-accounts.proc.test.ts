import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { git, scratch } from "./scenarios.ts";
import { hireIn } from "./stage.ts";

const SPENT = "sk-spent";
const FRESH = "sk-fresh";

const REFUSED_BY = `#!/bin/bash
cat >/dev/null
printf '%s\\n' "$CLAUDE_CODE_OAUTH_TOKEN" >>"$ACCOUNTS_TRIED"
printf '%s\\n' "$REFUSAL"
exit 1
`;

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

function claudeIn(script: string) {
  const root = scratch("stage-accounts-");
  const tree = join(root, "tree");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(tree);
  git(tree, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(root, "bin", "claude"), script);
  chmodSync(join(root, "bin", "claude"), 0o755);
  vi.stubEnv("PATH", `${join(root, "bin")}:${process.env.PATH}`);
  vi.stubEnv("STAGE_MINUTES", undefined);
  vi.stubEnv("TREE_PATH", undefined);
  vi.stubEnv("ACCOUNTS_TRIED", join(root, "accounts"));
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", SPENT);
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN_2", FRESH);
  return { tree, tried: () => readFileSync(join(root, "accounts"), "utf8").split("\n").filter(Boolean) };
}

const CLOUDFLARE = { type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Failed to authenticate. API Error: 403 Attention Required! | Cloudflare" }] } };

describe("a hire every Claude account refuses says when to try again, where it once marked its issue stuck after one 5 s retry (#1765)", () => {
  it.each([
    ["a login failure, such as Mezzanine#2929's Cloudflare 403, waits 30 minutes", [CLOUDFLARE, { type: "result", is_error: true, result: "Failed to authenticate. API Error: 403 Attention Required! | Cloudflare" }], true, 30],
    ["an empty token's 'Not logged in' waits 30 minutes", [{ type: "result", is_error: true, result: "Not logged in · Please run /login" }], true, 30],
    ["a usage limit naming no reset waits 1 hour", [{ type: "result", is_error: true, result: "Claude AI usage limit reached" }], false, 60],
  ])("%s, after trying the other account at once", async (_, refusal, login, minutes) => {
    const { tree, tried } = claudeIn(REFUSED_BY);
    vi.stubEnv("REFUSAL", refusal.map((event) => JSON.stringify(event)).join("\n"));
    vi.resetModules();
    const fresh = await import("./stage.ts");
    const before = Date.now();

    const spent = await fresh.hireIn(tree, "fix", "2929", { name: "builder", model: "opus", effort: "medium" })("build it");

    expect(tried()).toEqual([SPENT, FRESH]);
    expect(spent.accountsBack?.login).toBe(login);
    const waited = ((spent.accountsBack?.until ?? 0) - before) / 60_000;
    expect(waited).toBeGreaterThanOrEqual(minutes);
    expect(waited).toBeLessThan(minutes + 1);
  });
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

const GH_HOLDS_A_BODY = `#!/bin/bash
case "$1 $2" in
  "issue view") cat "$ISSUE_BODY" 2>/dev/null || true ;;
  "issue edit") printf '%s' "$5" >"$ISSUE_BODY" ;;
esac
`;

describe("a login failure on every account waits 30 minutes at a time and calls the owner only after 3 such waits in a row (#1765)", () => {
  it("parks the issue on the first 3 failures in a row, names the login failure when marking stuck on the 4th, and counts afresh after a gap", async () => {
    const root = scratch("account-waits-");
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", "gh"), GH_HOLDS_A_BODY);
    writeFileSync(join(root, "bin", "mark"), `#!/bin/bash\nprintf '%s\\n' "$2" >>"${join(root, "marks")}"\n`);
    for (const tool of ["gh", "mark"]) chmodSync(join(root, "bin", tool), 0o755);
    vi.stubEnv("PATH", `${join(root, "bin")}:${process.env.PATH}`);
    vi.stubEnv("MACHINE_BIN", join(root, "bin"));
    vi.stubEnv("ISSUE_BODY", join(root, "body"));
    vi.resetModules();
    const { parkedOnAccounts } = await import("./account-wait.ts");
    const said = "Failed to authenticate. API Error: 403 Attention Required! | Cloudflare";
    const failedAt = (now: number) => parkedOnAccounts("2929", { until: now + 30 * 60_000, login: true, said }, now);
    const start = Date.parse("2026-11-13T09:48:00Z");
    const minutes = (count: number) => start + count * 60_000;

    const waits = [failedAt(minutes(0)), failedAt(minutes(45)), failedAt(minutes(90))];
    const fourth = failedAt(minutes(135));
    const afterAGap = failedAt(minutes(600));

    expect(waits.map((wait) => "parked" in wait)).toEqual([true, true, true]);
    expect(fourth).toEqual({ stuck: expect.stringContaining(said) as string });
    expect("parked" in afterAGap).toBe(true);
    expect(readFileSync(join(root, "body"), "utf8")).toBe("Waits for a Claude account until 2026-11-13T20:18Z, login wait 1 of 3.\n");
  });
});
