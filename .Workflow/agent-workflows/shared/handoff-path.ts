import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_HANDOFF_PATH = ".Workflow/agent-workflows/handoff.txt";

export function handoffPath(): string {
  return process.env.FAILURE_REASON_PATH || DEFAULT_HANDOFF_PATH;
}

export function writeFailure(stage: string, reason: string): void {
  const path = handoffPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${stage}: ${reason}\n`, "utf8");
}
