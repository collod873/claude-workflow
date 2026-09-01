import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOC_RELATIVE_PATH,
  diffDoc,
  extractRulesProse,
  generateBoundariesDoc,
} from "./generate-boundaries-doc";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("generateBoundariesDoc", () => {
  it("matches this repository's own committed docs/agents/module-boundaries.md byte-for-byte", () => {
    const committed = readFileSync(join(REPO_ROOT, DOC_RELATIVE_PATH), "utf8");
    expect(generateBoundariesDoc(REPO_ROOT)).toBe(committed);
  });

  it("names all three rules and the baseline count", () => {
    const doc = generateBoundariesDoc(REPO_ROOT);
    expect(doc).toContain("no-lane-to-lane");
    expect(doc).toContain("shared-no-lane");
    expect(doc).toContain("no-circular");
    expect(doc).toMatch(/\d+ standing violation\(s\)/);
  });
});

describe("extractRulesProse", () => {
  it("throws when the config's header no longer carries the block this doc reads from", () => {
    expect(() => extractRulesProse("/** nothing relevant here */\nmodule.exports = {};\n")).toThrow(
      /Three rules/,
    );
  });
});

describe("diffDoc", () => {
  // A single test-owned dir, cleaned up by the one test that creates it, rather than the
  // multi-test `dirs` accumulator other suites in this file use — this describe block only ever
  // needs one.
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("is undefined when the committed doc already matches a fresh generation", () => {
    const committedPath = join(REPO_ROOT, DOC_RELATIVE_PATH);
    expect(diffDoc(REPO_ROOT, committedPath)).toBeUndefined();
  });

  it("names the mismatch and the regenerate command when the committed doc is stale", () => {
    dir = mkdtempSync(join(tmpdir(), "boundaries-doc-diff-"));
    const stalePath = join(dir, "module-boundaries.md");
    writeFileSync(stalePath, "# stale\n");

    const message = diffDoc(REPO_ROOT, stalePath);
    expect(message).toContain(stalePath);
    expect(message).toContain("generate-boundaries-doc.ts");
  });
});
