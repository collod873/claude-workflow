import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { childEnv } from "../shared/child-env";
import { MACHINE_ROOT } from "../shared/run-gauntlet";

export const REFUSED = "failure";

export function gatesThisRun(immutabilityResult: string): boolean {
  return immutabilityResult !== REFUSED;
}

function main(): void {
  if (!gatesThisRun(process.env.IMMUTABILITY_RESULT || "")) {
    console.log("the claim was refused before it reached the gate, so there is nothing here to judge.");
    return;
  }

  const run = spawnSync("npm", ["run", "check"], {
    cwd: MACHINE_ROOT,
    stdio: "inherit",
    env: { ...childEnv(), TARGET_WORKSPACE: process.env.TARGET_WORKSPACE || process.cwd() },
  });
  process.exitCode = run.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
