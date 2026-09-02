import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MACHINE_ROOT, runGauntlet } from "./run-gauntlet.ts";

// `MACHINE_ROOT` is resolved from this module's own location by counting `..` segments, and a
// miscount is invisible to every existing caller's test: `integrate.test.ts` injects a stub
// `runGauntlet`, so the real spawn's path is never exercised. The one it landed with (b75018a)
// pointed at `.Workflow/`, and `execFileSync` on `.Workflow/bin/gauntlet` throws `ENOENT` with no
// status and no output — which `runRealGauntlet` maps to `no-run`, and lane 08 printed exactly
// that for every merge until someone read the runner's filesystem instead of its log.
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
