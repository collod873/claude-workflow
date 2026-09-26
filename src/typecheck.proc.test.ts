import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { execute } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");

describe("a read the index may miss is typed as missing (#910)", () => {
  it("sets noUncheckedIndexedAccess in tsconfig.json, and tsc passes over the repo with it", () => {
    const config = JSON.parse(readFileSync(join(REPO, "tsconfig.json"), "utf8")) as { compilerOptions: Record<string, unknown> };

    expect(config.compilerOptions.noUncheckedIndexedAccess).toBe(true);

    const typecheck = execute(join(REPO, "node_modules", ".bin", "tsc"), REPO, {}, ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"]);

    expect(typecheck.stdout).toBe("");
    expect(typecheck.status).toBe(0);
  });
});
