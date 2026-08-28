import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The close gate, driven from this repo rather than from the machine that authored it.
 *
 * `.claude/hooks/close-gate.py` is a checked-in copy of a machine-global hook, and the
 * copy is the whole point: a stage on a GitHub-hosted runner has nothing under `~/`, so a
 * gate that lived only there judged nothing the pipeline did. What is checked in is what
 * runs, which means what is checked in is what has to be tested — here, at this repo's own
 * `test` slot, on this repo's own layout.
 *
 * Three things can break the copy without breaking the original, and each has a case
 * below: `_hook.py` failing to find this repo's `bin/` (two directories up, where the
 * original's is one); the copy finding *itself* on disk and standing down as though some
 * other gate owned the close; and `python3` not being on the PATH the hook is spawned
 * with. None of those would show up as a failure — all three fail open, silently, which
 * is the one shape a gate may not have (CONTEXT.md).
 *
 * The gate's own grammar — how a record is parsed, which arithmetic denies it — is tested
 * upstream in `hooks/test_close_gate.py` beside the file that implements it, and is not
 * restated here. This asks only whether the copy in this tree is wired and alive.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/close-gate.py");

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/**
 * A `gh` that answers the one call this hook makes (`gh issue view --json body,comments`)
 * from a fixed payload, and records nothing else. Pointed at through `AGENT_SKILLS_GH`,
 * `bin/gh_support.py`'s override — so no case here reaches the network or the real tracker.
 */
function stubGh(body: string, comments: { body: string; createdAt: string }[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "close-gate-gh-"));
  scratch.push(dir);
  const path = join(dir, "gh");
  const payload = JSON.stringify(JSON.stringify({ body, comments }));
  writeFileSync(path, `#!/bin/bash\nprintf '%s' ${payload}\n`);
  chmodSync(path, 0o755);
  return path;
}

type HookResult = { status: number | null; stdout: string; denied: boolean; reason: string };

function runHook(
  command: string,
  { cwd = REPO_ROOT, gh, home }: { cwd?: string; gh?: string; home?: string } = {},
): HookResult {
  const home_ = home ?? mkdtempSync(join(tmpdir(), "close-gate-home-"));
  if (!home) scratch.push(home_);
  const run = spawnSync("python3", [HOOK], {
    input: JSON.stringify({
      session_id: "vitest",
      cwd,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    }),
    encoding: "utf8",
    env: { ...process.env, HOME: home_, AGENT_SKILLS_GH: gh ?? "" },
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

describe("the checked-in close gate", () => {
  it("refuses a close that carries no closing record", () => {
    const result = runHook("gh issue close 55 --comment 'done'", { gh: stubGh(A_TICKET) });

    expect(result.denied, result.stdout).toBe(true);
    // Every deny hands over the in-repo tool, never a path outside this checkout: a stage
    // on a runner has no `~/.agents` and no `~/bin`, so a refusal pointing there is a
    // refusal with no repair.
    expect(result.reason).toContain("bin/close-ticket");
    expect(result.reason).not.toContain("~/.agents");
  });

  it("names this checkout as the one to run close-ticket against", () => {
    // The proof that `_hook.py` resolved this repo's `bin/`: the stub is built from the
    // working tree's own toplevel, which is also where `bin/close-ticket` lives. A copy
    // whose import path went to the wrong `bin/` would have died on import instead.
    const result = runHook("gh issue close 55 --comment 'done'", { gh: stubGh(A_TICKET) });

    expect(result.reason).toContain(`bin/close-ticket 55 <base>..<head> ${REPO_ROOT}`);
  });

  it("does not stand down for the copy of itself it finds in this tree", () => {
    // The stand-down exists so the machine-global hook defers to this one. If it read
    // "this repo ships a gate" without asking whether that gate is the file now running,
    // this copy would find itself, defer to itself, and gate nothing at all — while every
    // other assertion here still passed.
    const result = runHook("gh issue close 55 --comment 'done'", { gh: stubGh(A_TICKET) });

    expect(result.denied, "the repo's own copy stood down for itself").toBe(true);
  });

  it("allows a close that withdraws the delivery claim, without reading a record", () => {
    // ADR-0013's scope rule. `gh` is deliberately left unresolvable: reaching it at all
    // would mean the hook had gone looking for a record it has no business wanting.
    const result = runHook("gh issue close 55 --reason not-planned");

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it("stays silent on a command that is not a close", () => {
    const result = runHook("npm test");

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it("refuses rather than passes when it cannot reach the tracker", () => {
    // The direction that matters. An unresolvable `gh` is the shape an outage, a PATH gap
    // or a missing binary takes inside a stage, and a gate that waved those through would
    // be indistinguishable from no gate on exactly the days it is needed.
    const result = runHook("gh issue close 55 --comment 'done'");

    expect(result.denied, result.stdout).toBe(true);
  });

  it("is registered as a PreToolUse hook on Bash, spawned with an interpreter", () => {
    // The file being correct is worth nothing if nothing runs it. Read from the settings
    // this repo checks in, not from the merged view a session happens to have.
    const settings = JSON.parse(
      readFileSync(join(REPO_ROOT, ".claude/settings.json"), "utf8"),
    ) as { hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]> };

    const commands = (settings.hooks.PreToolUse ?? [])
      .filter((entry) => entry.matcher === "Bash")
      .flatMap((entry) => entry.hooks.map((hook) => hook.command));

    const gate = commands.find((command) => command.includes("close-gate.py"));
    expect(gate, "no PreToolUse/Bash hook runs close-gate.py").toBeDefined();
    // `python3 <path>`, never the bare path: the hook's executable bit does not survive
    // every checkout, and a runner that lost it would fail open with a shell error.
    expect(gate).toMatch(/^python3 /);
  });
});
