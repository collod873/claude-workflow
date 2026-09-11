import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const hooksDir = fileURLToPath(new URL("../hooks/", import.meta.url));

test.fails(
  "#402.3: a regression harness under hooks/test_*.py reproduces the commit-trailer bypass and asserts it no longer closes ungated",
  () => {
    const harnesses = existsSync(hooksDir)
      ? readdirSync(hooksDir).filter(
          (entry) => entry.startsWith("test_") && entry.endsWith(".py"),
        )
      : [];

    expect(harnesses.length).toBeGreaterThan(0);

    for (const harness of harnesses) {
      const run = spawnSync("python3", [join(hooksDir, harness)], {
        encoding: "utf8",
      });
      expect(run.status).toBe(0);
    }
  },
);
