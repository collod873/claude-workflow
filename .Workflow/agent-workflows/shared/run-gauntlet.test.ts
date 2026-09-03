import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MACHINE_ROOT, runGauntlet } from "./run-gauntlet.ts";

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
