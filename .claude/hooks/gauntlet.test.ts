import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The hook is a pure function of stdin to (exit code, stdout), so it gets driven rather than read.
// Every case below is what the venue *should* do, decided from DESIGN.md §06 rather than from what
// the script currently happens to return.
//
// Nothing here spawns the real gauntlet at the `stop` or `push` venue: both run the unit suite, and
// this file is in it. Those venues are covered through GAUNTLET_BIN instead.

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/gauntlet.sh");

/** bin/gauntlet's "the checks never ran" exit code, which must never surface as a finding. */
const COULD_NOT_RUN = 2;

/**
 * The few cases below that drive the real tsc and eslint rather than a stub. A cold GitHub runner
 * takes several seconds where this workstation takes under one, and vitest's 5s default turns that
 * difference into a red build — an environment flake in the meta-layer, which is the one thing the
 * gauntlet may not become.
 */
const REAL_TOOLCHAIN = 120_000;

type HookResult = { status: number | null; stdout: string; stderr: string };

function runHook(venue: string, payload: string, env: Record<string, string> = {}): HookResult {
  const run = spawnSync(HOOK, [venue], {
    input: payload,
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** A gauntlet that reports whatever the test needs it to, without running any checks. */
function stubGauntlet(exitCode: number, stdout = "", stderr = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-stub-"));
  stubDirs.push(dir);
  const path = join(dir, "gauntlet");
  writeFileSync(
    path,
    // Absolute interpreter for the same reason the real scripts use one: the PATH-scrubbed cases
    // below would otherwise fail on the stub rather than on the code under test.
    `#!/bin/bash\nprintf '%s' ${JSON.stringify(stdout)}\n` +
      `printf '%s' ${JSON.stringify(stderr)} >&2\nexit ${exitCode}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

const stubDirs: string[] = [];
afterEach(() => {
  while (stubDirs.length) rmSync(stubDirs.pop()!, { recursive: true, force: true });
});

const editOf = (filePath: string) =>
  JSON.stringify({ hook_event_name: "PostToolUse", tool_input: { file_path: filePath } });

describe("the in-turn venue", () => {
  it(
    "says nothing about a file that already passes",
    () => {
      const result = runHook("turn", editOf(".Workflow/agent-workflows/shared/reason.ts"));

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    },
    REAL_TOOLCHAIN,
  );

  it("hands a failure back to Claude rather than refusing the edit", () => {
    const gauntlet = stubGauntlet(1, "--- typecheck ---\nerror TS2322: nope\n");

    const result = runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: gauntlet });

    // exit 0 is load-bearing: JSON emitted alongside a non-zero exit is discarded by the harness.
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("error TS2322: nope");
  });

  it("ignores a file it has nothing to say about", () => {
    const gauntlet = stubGauntlet(1, "should never run");

    const result = runHook("turn", editOf("DESIGN.md"), { GAUNTLET_BIN: gauntlet });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("ignores a TypeScript file outside this repo", () => {
    const gauntlet = stubGauntlet(1, "should never run");

    const result = runHook("turn", editOf("/etc/somewhere/else.ts"), { GAUNTLET_BIN: gauntlet });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("passes the over-budget line to the user, not to Claude", () => {
    const gauntlet = stubGauntlet(1, "--- lint ---\nboom\n", "gauntlet: turn took 4000ms against a 1000ms budget\n");

    const result = runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: gauntlet });

    const out = JSON.parse(result.stdout);
    expect(out.systemMessage).toContain("against a 1000ms budget");
    expect(out.reason).not.toContain("budget");
  });
});

describe("the turn-end venue", () => {
  it("reports a failure once", () => {
    const gauntlet = stubGauntlet(1, "--- test ---\n1 failed\n");

    const result = runHook("stop", JSON.stringify({ hook_event_name: "Stop" }), {
      GAUNTLET_BIN: gauntlet,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).reason).toContain("1 failed");
  });

  it("stays quiet once it has already reported, so a red suite mid-task cannot hold the session", () => {
    const gauntlet = stubGauntlet(1, "--- test ---\n1 failed\n");

    const result = runHook(
      "stop",
      JSON.stringify({ hook_event_name: "Stop", stop_hook_active: true }),
      { GAUNTLET_BIN: gauntlet },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("failing open", () => {
  it("stays quiet when the gauntlet could not run its checks", () => {
    // Exit 2 is not a finding. Reporting it as one would tell Claude its code is broken because
    // node_modules is missing.
    const gauntlet = stubGauntlet(COULD_NOT_RUN, "", "gauntlet: no node on PATH — checks not run\n");

    const result = runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: gauntlet });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("stays quiet on a payload it cannot parse", () => {
    const gauntlet = stubGauntlet(1, "should never run");

    const result = runHook("turn", "not json at all", { GAUNTLET_BIN: gauntlet });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("survives a shell with no usable PATH and no HOME", () => {
    // The shim's own degraded case. Whether node turns up in a standard directory is a fact about
    // the machine — it does on a GitHub runner and does not on this workstation — so the assertion
    // is the contract that holds either way: exit 0, and nothing that isn't valid hook output.
    // An earlier version of this test asserted the not-found branch specifically and went red on
    // the runner only, which is the exact flake shape DESIGN.md §06 makes a precondition.
    const gauntlet = stubGauntlet(COULD_NOT_RUN);

    const result = spawnSync(HOOK, ["turn"], {
      input: editOf("a.ts"),
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { PATH: "/nonexistent", HOME: "/nonexistent", GAUNTLET_BIN: gauntlet },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("finds node anyway when only PATH is missing, which is the case that actually happens", () => {
    const gauntlet = stubGauntlet(1, "--- lint ---\nboom\n");

    const result = spawnSync(HOOK, ["turn"], {
      input: editOf("a.ts"),
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { PATH: "/nonexistent", HOME: process.env.HOME ?? "", GAUNTLET_BIN: gauntlet },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).reason).toContain("boom");
  });
});

describe("the check runner", () => {
  it(
    "runs its checks with nothing but node on a scrubbed PATH",
    () => {
      // The venue that actually happens: a hook shell with no login PATH. This drives the real tsc
      // and eslint, so it also proves the tool shims resolve.
      const run = spawnSync(join(REPO_ROOT, "bin/gauntlet"), ["turn", "bin/node-on-path.sh"], {
        encoding: "utf8",
        cwd: REPO_ROOT,
        env: { PATH: "/nonexistent", HOME: process.env.HOME ?? "" },
      });

      expect(run.stdout).toBe("");
      expect(run.status).toBe(0);
    },
    REAL_TOOLCHAIN,
  );

  it("will not report a missing file as a lint failure", () => {
    const run = spawnSync(join(REPO_ROOT, "bin/gauntlet"), ["turn", "no-such-file.ts"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });

    expect(run.status).toBe(COULD_NOT_RUN);
    expect(run.stdout).toBe("");
  });

  it("refuses an unknown venue rather than silently checking nothing", () => {
    const run = spawnSync(join(REPO_ROOT, "bin/gauntlet"), ["overnight"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage:");
  });
});
