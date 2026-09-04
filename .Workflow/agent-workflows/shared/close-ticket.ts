import { spawnSync } from "node:child_process";
import { childEnv } from "./child-env.ts";

export interface CloseTicketResult {
  exitCode: number;
  output: string;
}

export function closeTicketProcess(args: readonly string[]): CloseTicketResult {
  // @shell spawns `bin/close-ticket`: an extensionless argv[0] knip reads as an unresolved import.
  const result = spawnSync("bin/close-ticket", [...args], {
    encoding: "utf8",
    env: childEnv(),
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? result.error.message : ""}`;
  return { exitCode: result.status ?? 1, output };
}
