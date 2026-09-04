import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnv } from "./child-env.ts";
import { reason } from "./reason.ts";

export const MACHINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export type GauntletVenue = "turn" | "stop" | "push";

export type GauntletExec = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: "utf8"; maxBuffer: number; env: NodeJS.ProcessEnv },
) => string;

const execReal: GauntletExec = (command, args, options) => execFileSync(command, args, options);

export function runGauntlet(venue: GauntletVenue, targetRoot: string, deps: { exec?: GauntletExec } = {}): string {
  const exec = deps.exec ?? execReal;
  return exec(join(MACHINE_ROOT, "bin/gauntlet"), [venue], {
    cwd: MACHINE_ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: { ...childEnv(), TARGET_WORKSPACE: targetRoot },
  });
}

export type GateVerdict = { ok: true } | { ok: false; output: string };

export function gateVerdict(targetRoot: string, deps: { exec?: GauntletExec } = {}): GateVerdict {
  try {
    runGauntlet("push", targetRoot, deps);
    return { ok: true };
  } catch (err) {
    const withOutput = err as { stdout?: unknown; stderr?: unknown };
    if (withOutput && ("stdout" in withOutput || "stderr" in withOutput)) {
      const stdout = typeof withOutput.stdout === "string" ? withOutput.stdout : "";
      const stderr = typeof withOutput.stderr === "string" ? withOutput.stderr : "";
      return { ok: false, output: `${stdout}${stderr}`.trim() };
    }
    return { ok: false, output: reason(err) };
  }
}
