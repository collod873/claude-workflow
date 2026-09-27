import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parts } from "./parts.ts";

const REPO = resolve(import.meta.dirname, "..");

describe("the machine keeps no brief command (#946)", () => {
  it("keeps no brief command", () => {
    expect(parts.map((part) => part.name)).not.toContain("bin/brief");
    expect(existsSync(join(REPO, "bin", "brief"))).toBe(false);
    expect(readFileSync(join(REPO, "src", "brief.ts"), "utf8")).not.toContain("import.meta.main");
  });
});
