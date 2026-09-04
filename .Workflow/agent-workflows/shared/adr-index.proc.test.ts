import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADR_DIR, INDEX_RELATIVE_PATH, regenerateAdrIndex } from "./adr-index";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ADR_CHECK = join(process.env.HOME ?? "", "bin/adr-check");

describe("the in-repo renderer and adr-check", () => {
  it.skipIf(!existsSync(ADR_CHECK))(
    "agree byte for byte over this repo's own corpus, so the writer on a runner cannot stale the gate on the workstation",
    () => {
      const root = mkdtempSync(join(tmpdir(), "adr-parity-"));
      mkdirSync(join(root, ADR_DIR), { recursive: true });
      cpSync(join(REPO_ROOT, ADR_DIR), join(root, ADR_DIR), { recursive: true });
      execFileSync("git", ["init", "-q", root]);

      try {
        execFileSync(ADR_CHECK, ["--fix"], { cwd: root, stdio: "ignore" });
      } catch {
        expect(existsSync(join(root, INDEX_RELATIVE_PATH))).toBe(true);
      }
      const fromChecker = readFileSync(join(root, INDEX_RELATIVE_PATH), "utf8");

      writeFileSync(join(root, INDEX_RELATIVE_PATH), "stale\n");
      expect(regenerateAdrIndex(root)).toBe(true);

      expect(readFileSync(join(root, INDEX_RELATIVE_PATH), "utf8")).toBe(fromChecker);
    },
  );
});
