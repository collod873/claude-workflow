import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchDir } from "../../.Workflow/agent-workflows/shared/scratch.fixture";
import { stubGh } from "../../.Workflow/agent-workflows/shared/stub-gh.fixture";
import settings from "../settings.json";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/close-gate.py");

const NO_GH = join(REPO_ROOT, ".claude/hooks/no-such-gh");

type HookResult = { status: number | null; stdout: string; denied: boolean; reason: string };

function runHook(command: string, gh: string = NO_GH): HookResult {
  const run = spawnSync("python3", [HOOK], {
    input: JSON.stringify({
      session_id: "vitest",
      cwd: REPO_ROOT,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    }),
    encoding: "utf8",
    env: { ...process.env, HOME: scratchDir("close-gate-home"), AGENT_SKILLS_GH: gh },
  });
  const stdout = run.stdout ?? "";
  const parsed = stdout.trim() ? JSON.parse(stdout) : {};
  const hso = parsed.hookSpecificOutput ?? {};
  return {
    status: run.status,
    stdout,
    denied: hso.permissionDecision === "deny",
    reason: hso.permissionDecisionReason ?? "",
  };
}

const A_TICKET = "Part of #29.\n\n## Acceptance criteria\n- [ ] criterion one\n";

function bareClose(): HookResult {
  return runHook("gh issue close 55 --comment 'done'", stubGh(A_TICKET).path);
}

describe("the checked-in close gate", () => {
  it("refuses a close that carries no closing record", () => {
    const result = bareClose();

    expect(result.denied, result.stdout).toBe(true);
    expect(result.reason).toContain("bin/close-ticket");
    expect(result.reason).not.toContain("~/.agents");
  });

  it("names this checkout as the one to run close-ticket against", () => {
    const result = bareClose();

    expect(result.reason).toContain(`bin/close-ticket 55 <base>..<head> ${REPO_ROOT}`);
  });

  it("does not stand down for the copy of itself it finds in this tree", () => {
    const result = bareClose();

    expect(result.denied, "the repo's own copy stood down for itself").toBe(true);
  });

  it("allows a close that withdraws the delivery claim, without reading a record", () => {
    const result = runHook("gh issue close 55 --reason not-planned");

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it("stays silent on a command that is not a close", () => {
    const result = runHook("make test");

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it("refuses rather than passes when it cannot reach the tracker", () => {
    const result = runHook("gh issue close 55 --comment 'done'");

    expect(result.denied, result.stdout).toBe(true);
  });

  it("is registered as a PreToolUse hook on Bash, spawned with an interpreter", () => {
    const hooks = settings.hooks as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    const commands = (hooks.PreToolUse ?? [])
      .filter((entry) => entry.matcher === "Bash")
      .flatMap((entry) => entry.hooks.map((hook) => hook.command));

    const gate = commands.find((command) => command.includes("close-gate.py"));
    expect(gate, "no PreToolUse/Bash hook runs close-gate.py").toBeDefined();
    expect(gate).toMatch(/^python3 /);
  });
});
