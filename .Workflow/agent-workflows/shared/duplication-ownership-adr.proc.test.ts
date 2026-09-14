import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const adrDir = join(repoRoot, "docs", "adr");

function landedAdrs(): string[] {
  if (!existsSync(adrDir)) return [];
  return readdirSync(adrDir)
    .filter((name) => name.startsWith("0") && name.endsWith(".md"))
    .map((name) => join("docs", "adr", name));
}

function naming(needle: string, files: string[]): string[] {
  if (files.length === 0) return [];
  try {
    return execFileSync("grep", ["-l", "-F", "-e", needle, ...files], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function adrsNamingAll(needles: string[]): string[] {
  return needles.reduce((files, needle) => naming(needle, files), landedAdrs());
}

const THREE_PAIRS = ["PATH_LINE_RE", "canary-graph", "gh_support"];

test.fails("#552.1: a landed ADR names PATH_LINE_RE, the canary-graph trigger stubs and gh_support.py as three pairs kept split on purpose", () => {
  expect(adrsNamingAll(THREE_PAIRS).length).toBeGreaterThanOrEqual(1);
});

test.fails("#552.2: that ADR names canary-graph-triggers.proc.test.ts as the worked example of a guard that asserts the axis it claims", () => {
  expect(
    adrsNamingAll([...THREE_PAIRS, "canary-graph-triggers.proc.test.ts"]).length,
  ).toBeGreaterThanOrEqual(1);
});
