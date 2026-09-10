import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINK_WORKSTATION = join(REPO_ROOT, "bin", "link-workstation");

const SETTINGS = `${JSON.stringify({ hooks: {}, model: "sonnet", env: { EDITOR: "vim" } }, null, 2)}\n`;

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "link-workstation-"));
  mkdirSync(join(home, "bin"), { recursive: true });
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  mkdirSync(join(home, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), SETTINGS);
  return home;
}

function run(home: string, args: string[]) {
  return spawnSync("python3", [LINK_WORKSTATION, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: home },
  });
}

test.fails(
  "#424.1: run from a clone that is not ~/.agents/workflow, link-workstation exits non-zero before any link or settings write, naming both paths",
  () => {
    const home = makeHome();
    const workstationClone = join(home, ".agents", "workflow");
    try {
      for (const args of [["--dry-run"], ["--apply", "--settings"]]) {
        const result = run(home, args);
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

        expect(result.status).not.toBe(0);
        expect(output).toContain(REPO_ROOT);
        expect(output.includes(workstationClone) || output.includes("~/.agents/workflow")).toBe(true);
      }

      expect(existsSync(join(home, "bin", "close-ticket"))).toBe(false);
      expect(existsSync(join(home, ".claude", "skills", "tdd"))).toBe(false);
      expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(SETTINGS);
      expect(existsSync(join(home, ".claude", "settings.json.pre-dispatch"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
