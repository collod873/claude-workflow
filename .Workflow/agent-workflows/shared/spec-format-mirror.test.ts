import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CANONICAL = resolve(import.meta.dirname, "../../../docs/agents/spec-format.md");
const MIRROR = join(homedir(), ".agents/workflow/docs/agents/spec-format.md");

describe("the working checkout and the workstation clone", () => {
  it.skipIf(!existsSync(MIRROR))("carry the same spec contract", () => {
    expect(readFileSync(MIRROR, "utf8")).toBe(readFileSync(CANONICAL, "utf8"));
  });
});
