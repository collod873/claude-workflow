import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-sources";

export const CHECK_CONTRACT_FILE = ".claude/contract.json";

export interface CheckSlot {
  name: string;
  cmd: string;
  why: string;
}

export function readCheckContract(repoDir: string = REPO_ROOT): string | undefined {
  try {
    return readFileSync(join(repoDir, CHECK_CONTRACT_FILE), "utf8");
  } catch {
    return undefined;
  }
}

export function parseCheckSlots(json: string | undefined): CheckSlot[] {
  if (json === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const slots: CheckSlot[] = [];
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const { cmd, why } = value as { cmd?: unknown; why?: unknown };
    if (typeof cmd !== "string" || cmd.length === 0) continue;
    slots.push({ name, cmd, why: typeof why === "string" ? why : "" });
  }
  return slots;
}

export function renderCheckContractSection(json: string | undefined): string {
  const slots = parseCheckSlots(json);
  if (slots.length === 0) return "(none)";
  return slots
    .map((slot) => (slot.why.length > 0 ? `- \`${slot.name}\`: \`${slot.cmd}\` — ${slot.why}` : `- \`${slot.name}\`: \`${slot.cmd}\``))
    .join("\n");
}
