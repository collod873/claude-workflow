import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const CLAUDE_STREAMS_DIR_ENV = "CLAUDE_STREAMS_DIR";

export function claudeStreamPath(env: NodeJS.ProcessEnv, now = new Date()): string | undefined {
  const dir = env[CLAUDE_STREAMS_DIR_ENV];
  if (!dir) return undefined;
  mkdirSync(dir, { recursive: true });
  return join(dir, `${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.jsonl`);
}
