import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const HOOKS_LIB = resolve(import.meta.dirname);
const SEEDED_HOOKS = join(homedir(), ".agents", "skills", "hooks");

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("#374.1: .claude/hooks/lib/_hook.mjs and _hook.sh exist", () => {
  for (const name of ["_hook.mjs", "_hook.sh"]) {
    expect(existsSync(join(HOOKS_LIB, name)), `${name} is missing`).toBe(true);
  }
});

test.fails("#382.1: .claude/hooks/lib/_hook.mjs and _hook.sh are byte-identical to agent-skills' hooks/_hook.mjs and hooks/_hook.sh", () => {
  for (const name of ["_hook.mjs", "_hook.sh"]) {
    const copy = join(HOOKS_LIB, name);
    const seed = join(SEEDED_HOOKS, name);

    expect(existsSync(copy), `${copy} is missing`).toBe(true);
    expect(existsSync(seed), `${seed} is missing`).toBe(true);
    expect(digest(copy), `${copy} is not a byte-identical copy of ${seed}`).toBe(digest(seed));
  }
});
