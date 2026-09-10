import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("#425.3: the ticket format doc states the rule", () => {
  const result = spawnSync("grep", ["-qi", "immutable set", "docs/agents/ticket-format.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
});
