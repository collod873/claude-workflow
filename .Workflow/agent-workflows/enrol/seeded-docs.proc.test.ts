import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { WORKSTATION_CLONE } from "./seeded-docs.ts";

const LINK_WORKSTATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "bin",
  "link-workstation",
);

test(
  "#424.2: the Python constant and enrol/seeded-docs.ts's WORKSTATION_CLONE name the same path",
  () => {
    const home = mkdtempSync(join(tmpdir(), "seeded-docs-workstation-"));
    const tildeForm = WORKSTATION_CLONE.replace(homedir(), "~");
    const underThisHome = tildeForm.replace(/^~/, home);
    try {
      const refusal = spawnSync("python3", [LINK_WORKSTATION, "--dry-run"], {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", HOME: home },
      });
      const named = `${refusal.stdout ?? ""}${refusal.stderr ?? ""}`;

      expect(refusal.status).not.toBe(0);
      expect(named.includes(underThisHome) || named.includes(tildeForm)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
