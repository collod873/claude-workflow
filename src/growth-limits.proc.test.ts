import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import ts from "typescript";
import { parse } from "yaml";
import { describe, expect, it, onTestFinished } from "vitest";
import { machinePage, signedRules, type SignedRule } from "./machine-page.ts";
import { FAILURE_LINK } from "./part-links.ts";
import { parts, type Part } from "./parts.ts";
import { coveredByCheck } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const SCREEN = { lines: 60, columns: 120 };
const WORKFLOWS = ".github/workflows/*.y*ml";
const MODULE = /\.(m|c)?[jt]s$/;
const WIRING = [".claude/*.json", WORKFLOWS, ".husky/*", "package.json"];
const SRC_OR_BIN = /(src|bin)\/[\w.-]+(\/[\w.-]+)*/g;
const REASONED_DROP = /^Test count drop: \S/m;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST")));

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "growth-limits-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function plant(root: string, file: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
  chmodSync(join(root, file), mode);
}

function offScreen(page: string): string[] {
  const lines = page.split("\n");
  const tooWide = lines.filter((line) => line.length > SCREEN.columns).map((line) => `wider than ${SCREEN.columns}: ${line}`);
  return lines.length > SCREEN.lines ? [`${lines.length} lines, over ${SCREEN.lines}`, ...tooWide] : tooWide;
}

function importedWithin(repo: string, files: string[]): Set<string> {
  return new Set(
    files
      .filter((path) => MODULE.test(path))
      .flatMap((path) => ts.preProcessFile(readFileSync(join(repo, path), "utf8"), true, true).importedFiles.map(({ fileName }) => ({ path, fileName })))
      .filter(({ fileName }) => fileName.startsWith("."))
      .map(({ path, fileName }) => normalize(join(dirname(path), fileName))),
  );
}

function wiredIn(repo: string): Set<string> {
  return new Set(
    globSync(WIRING, { cwd: repo })
      .filter((path) => statSync(join(repo, path)).isFile())
      .flatMap((path) => readFileSync(join(repo, path), "utf8").match(SRC_OR_BIN) ?? []),
  );
}

function unlinkedParts(repo: string, registry: Part[]): string[] {
  const registered = new Set(registry.map((part) => part.file));
  const files = ["src", "bin"]
    .flatMap((dir) => readdirSync(join(repo, dir), { recursive: true, encoding: "utf8" }).map((path) => join(dir, path)))
    .filter((path) => !path.split("/").includes("node_modules") && statSync(join(repo, path)).isFile());
  const covered = coveredByCheck(readFileSync(join(repo, "bin", "check"), "utf8"));
  const imported = importedWithin(repo, files);
  const runByPart = new Set(registry.flatMap((part) => (existsSync(join(repo, part.file)) ? readFileSync(join(repo, part.file), "utf8").match(SRC_OR_BIN) ?? [] : [])));
  const wired = wiredIn(repo);
  const unregistered = files
    .filter((path) => !registered.has(path))
    .filter((path) => (statSync(join(repo, path)).mode & 0o111) !== 0 || wired.has(path) || !(covered(path) || imported.has(path) || runByPart.has(path)))
    .sort()
    .map((path) => `${path} can run but is not a registered part`);
  const unlinked = registry.filter((part) => !FAILURE_LINK.test(part.stops)).map((part) => `${part.name} links no failure: ${part.stops}`);
  return [...unregistered, ...unlinked];
}

function timedWorkflows(repo: string): string[] {
  return globSync(WORKFLOWS, { cwd: repo })
    .sort()
    .filter((file) => {
      const on: unknown = parse(readFileSync(join(repo, file), "utf8"))?.on;
      const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
      return triggers.includes("schedule");
    })
    .map((file) => `${file} fires on a timer`);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function testsIn(root: string): number {
  if (!existsSync(join(root, "vitest.config.ts"))) return 0;
  if (!existsSync(join(root, "node_modules"))) symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  if (!existsSync(join(root, ".git"))) git(root, "init", "--quiet");
  const listed = execFileSync(join(REPO, "node_modules", ".bin", "vitest"), ["list", "--config", "vitest.config.ts", "--json"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return (JSON.parse(listed) as unknown[]).length;
}

function testCountDrop(repo: string): string[] {
  const base = git(repo, "merge-base", "HEAD", "origin/main");
  if (REASONED_DROP.test(git(repo, "log", "--format=%B", `${base}..HEAD`))) return [];
  const atBase = scratch();
  const archive = execFileSync("git", ["archive", base], { cwd: repo, env, maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", atBase], { input: archive });
  const before = testsIn(atBase);
  const now = testsIn(repo);
  return now < before ? [`the machine holds ${now} tests, below ${before} at the merge base ${base.slice(0, 12)}`] : [];
}

function unknownEnforcements(repo: string, registry: Part[], rules: SignedRule[]): string[] {
  const signed = new Set(rules.map((rule) => rule.text));
  const missing = registry.filter((part) => !existsSync(join(repo, part.file))).map((part) => `${part.name} names ${part.file}, which does not exist`);
  const unsigned = registry.flatMap((part) =>
    (part.holds ?? []).filter((rule) => !signed.has(rule)).map((rule) => `${part.name} holds a rule no signed page carries: ${rule}`),
  );
  return [...missing, ...unsigned];
}

const planted: Part = { name: "planted", file: "src/planted.ts", stops: "https://github.com/collod873/claude-workflow/issues/1" };

describe("the machine holds the charter's growth limits", () => {
  it("1. the machine page lists every part and every signed rule and fits one screen", () => {
    const rules = signedRules(REPO);
    const page = machinePage(parts, rules);

    expect(rules.filter((rule) => rule.page.endsWith("charter.md")).length).toBeGreaterThan(0);
    expect(rules.filter((rule) => rule.page.endsWith("one-ticket.md")).length).toBeGreaterThan(0);
    for (const part of parts) expect(page).toContain(part.name);
    expect(page.split("\n").filter((line) => /^ {2}(charter|one ticket) /.test(line))).toHaveLength(rules.length);
    expect(offScreen(page)).toEqual([]);

    const crowded = Array.from({ length: SCREEN.lines }, (_, n) => ({ ...planted, name: `planted ${n}` }));
    expect(offScreen(machinePage([...parts, ...crowded], rules))).toEqual([expect.stringMatching(/lines, over 60$/)]);
  });

  it("2. every registered part links the failure it stops, and everything under src/ and bin/ that can run is registered", () => {
    expect(unlinkedParts(REPO, parts)).toEqual([]);

    const copy = scratch();
    plant(copy, "bin/unregistered", "#!/bin/bash\n", 0o755);
    plant(copy, "src/planted.ts", "export {};\n");
    plant(copy, "bin/check", "#!/bin/bash\nrun lint eslint --config src/planted.config.js src\n", 0o755);
    plant(copy, "src/planted.config.js", "export default {};\n");
    plant(copy, "src/helper.ts", "export const help = 1;\n");
    plant(copy, "src/helper.test.ts", "import { help } from \"./helper.ts\";\n");
    plant(copy, "src/unwired.mjs", "export const decide = () => 0;\n");
    plant(copy, "src/wired.mjs", "export const decide = () => 0;\n");
    plant(copy, "src/wired.test.ts", "import { decide } from \"./wired.mjs\";\n");
    plant(copy, "package.json", "{\"scripts\": {\"go\": \"node src/wired.mjs\"}}\n");
    const check = { ...planted, name: "check", file: "bin/check" };
    const cleanup = { ...planted, name: "cleanup", stops: "https://github.com/collod873/claude-workflow/commit/c7fa969" };
    expect(unlinkedParts(copy, [{ ...planted, stops: "the owner said so" }, cleanup, check])).toEqual([
      "bin/unregistered can run but is not a registered part",
      "src/unwired.mjs can run but is not a registered part",
      "src/wired.mjs can run but is not a registered part",
      "planted links no failure: the owner said so",
      "cleanup links no failure: https://github.com/collod873/claude-workflow/commit/c7fa969",
    ]);
  });

  it("3. no workflow the machine owns fires on a timer", () => {
    expect(globSync(WORKFLOWS, { cwd: REPO })).not.toEqual([]);
    expect(timedWorkflows(REPO)).toEqual([]);

    const copy = scratch();
    plant(copy, ".github/workflows/tick.yml", "on:\n  push:\n  schedule:\n    - cron: \"0 * * * *\"\njobs: {}\n");
    plant(copy, ".github/workflows/listed.yml", "on: [push, schedule]\njobs: {}\n");
    plant(copy, ".github/workflows/event.yml", "on: issues\njobs: {}\n");
    expect(timedWorkflows(copy)).toEqual([".github/workflows/listed.yml fires on a timer", ".github/workflows/tick.yml fires on a timer"]);
  });

  it("4. the count of tests is not below the merge base with origin/main, unless a commit gives the reason", () => {
    expect(testCountDrop(REPO)).toEqual([]);

    const copy = scratch();
    git(copy, "init", "--quiet", "--initial-branch=main");
    git(copy, "config", "user.email", "limits@test");
    git(copy, "config", "user.name", "limits");
    copyFileSync(join(REPO, "vitest.config.ts"), join(copy, "vitest.config.ts"));
    plant(copy, "src/kept.test.ts", "import { it } from \"vitest\";\nit(\"one\", () => {});\nit(\"two\", () => {});\n");
    git(copy, "add", "vitest.config.ts", "src");
    git(copy, "commit", "--quiet", "-m", "base");
    git(copy, "update-ref", "refs/remotes/origin/main", "HEAD");
    plant(copy, "src/kept.test.ts", "import { it } from \"vitest\";\nit(\"one\", () => {});\n");
    expect(testCountDrop(copy)).toEqual([expect.stringMatching(/^the machine holds 1 tests, below 2 at the merge base [0-9a-f]{12}$/)]);

    git(copy, "commit", "--quiet", "-am", "Cut a copy\n\nTest count drop: the second test repeated the first");
    expect(testCountDrop(copy)).toEqual([]);
  });

  it("5. the check runner is the enforcer the page credits with the zero-test rule", () => {
    const rule = "A test check passes only if it ran at least one test";

    expect(parts.filter((part) => part.holds?.includes(rule)).map((part) => part.name)).toEqual(["src/check-runner.ts"]);
    expect(machinePage(parts, signedRules(REPO))).toContain(`${rule}  ← src/check-runner.ts`);
  });

  it("6. every registered enforcer names a rule a signed page carries, in a file that exists", () => {
    const rules = signedRules(REPO);
    expect(unknownEnforcements(REPO, parts, rules)).toEqual([]);

    const copy = scratch();
    const enforcer = { ...planted, holds: [rules[0].text, "A rule nobody signed"] };
    expect(unknownEnforcements(copy, [enforcer], rules)).toEqual([
      "planted names src/planted.ts, which does not exist",
      "planted holds a rule no signed page carries: A rule nobody signed",
    ]);
  });
});
