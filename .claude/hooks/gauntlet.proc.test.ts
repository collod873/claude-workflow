import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const HOOKS = dirname(fileURLToPath(import.meta.url));

test("#555.3: gauntlet.sh no longer answers to stop", () => {
  const script = readFileSync(join(HOOKS, "gauntlet.sh"), "utf8");

  expect(script.match(/= "stop"/g) ?? []).toEqual([]);
  expect(script).not.toMatch(/\$\{1:-\}"?\s*=\s*"?stop/);
});
