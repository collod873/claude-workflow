import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CANONICAL = resolve(import.meta.dirname, "../../../docs/agents/spec-format.md");
const MIRROR = join(homedir(), ".agents/skills/docs/agents/spec-format.md");

describe("the two copies of the spec contract", () => {
  it.skipIf(!existsSync(MIRROR))("are byte-identical", () => {
    expect(readFileSync(MIRROR, "utf8")).toBe(readFileSync(CANONICAL, "utf8"));
  });
});
