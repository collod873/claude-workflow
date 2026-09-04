import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gateVerdict, MACHINE_ROOT, runGauntlet } from "./run-gauntlet.ts";

describe("MACHINE_ROOT", () => {
  it("names the checkout that carries bin/gauntlet", () => {
    expect(existsSync(join(MACHINE_ROOT, "bin/gauntlet"))).toBe(true);
    expect(existsSync(join(MACHINE_ROOT, ".Workflow/agent-workflows/shared/run-gauntlet.ts"))).toBe(true);
  });
});

describe("runGauntlet", () => {
  it("spawns the machine's bin/gauntlet from the machine root with the target in TARGET_WORKSPACE", () => {
    const spawns: { command: string; args: string[]; cwd: string; target: string | undefined }[] = [];
    runGauntlet("push", "/tmp/some-target", {
      exec: (command, args, options) => {
        spawns.push({ command, args, cwd: options.cwd, target: options.env.TARGET_WORKSPACE });
        return "";
      },
    });
    expect(spawns).toEqual([
      {
        command: join(MACHINE_ROOT, "bin/gauntlet"),
        args: ["push"],
        cwd: MACHINE_ROOT,
        target: "/tmp/some-target",
      },
    ]);
  });
});

describe("gateVerdict", () => {
  it("is ok when the push venue's checks pass", () => {
    expect(gateVerdict("/tmp/some-target", { exec: () => "" })).toEqual({ ok: true });
  });

  it("reports stdout followed by stderr, trimmed, from a non-zero exit", () => {
    const err = Object.assign(new Error("Command failed"), { stdout: "  ran the gate\n", stderr: "1 test failed\n" });
    const verdict = gateVerdict("/tmp/some-target", {
      exec: () => {
        throw err;
      },
    });

    expect(verdict).toEqual({ ok: false, output: "ran the gate\n1 test failed" });
  });

  it("reports an empty output when a non-zero exit carries neither stream", () => {
    const err = Object.assign(new Error("Command failed"), { stdout: undefined, stderr: undefined });
    const verdict = gateVerdict("/tmp/some-target", {
      exec: () => {
        throw err;
      },
    });

    expect(verdict).toEqual({ ok: false, output: "" });
  });

  it("falls back to the error's message when there is no such binary to run", () => {
    const verdict = gateVerdict("/tmp/some-target", {
      exec: () => {
        throw new Error("spawnSync bin/gauntlet ENOENT");
      },
    });

    expect(verdict).toEqual({ ok: false, output: "spawnSync bin/gauntlet ENOENT" });
  });
});
