import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it, onTestFinished } from "vitest";
import { machinePage, signedRules, type SignedRule } from "./machine-page.ts";
import { parts, type Part } from "./parts.ts";

const REPO = resolve(import.meta.dirname, "..");
const SCREEN = { lines: 60, columns: 120 };
const FAILURE_LINK = /^https:\/\/github\.com\/collod873\/[\w.-]+\/(issues\/\d+|pull\/\d+|actions\/runs\/\d+|commit\/[0-9a-f]{7,40})$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
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

function unlinkedParts(repo: string, registry: Part[]): string[] {
  const registered = new Set(registry.map((part) => part.file));
  const unregistered = readdirSync(join(repo, "core"), { recursive: true, encoding: "utf8" })
    .map((path) => join("core", path))
    .filter((path) => !path.split("/").includes("node_modules") && statSync(join(repo, path)).isFile())
    .filter((path) => (statSync(join(repo, path)).mode & 0o111) !== 0 && !registered.has(path))
    .map((path) => `${path} runs but is not a registered part`);
  const unlinked = registry.filter((part) => !FAILURE_LINK.test(part.stops)).map((part) => `${part.name} links no failure: ${part.stops}`);
  return [...unregistered, ...unlinked];
}

function timedWorkflows(repo: string, registry: Part[]): string[] {
  return registry
    .filter((part) => WORKFLOW.test(part.file))
    .filter((part) => {
      const on: unknown = parse(readFileSync(join(repo, part.file), "utf8"))?.on;
      const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
      return triggers.includes("schedule");
    })
    .map((part) => `${part.name} fires on a timer`);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function testsIn(root: string): number {
  if (!existsSync(join(root, "core", "vitest.config.ts"))) return 0;
  if (!existsSync(join(root, "node_modules"))) symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  const listed = execFileSync(join(REPO, "node_modules", ".bin", "vitest"), ["list", "--config", "core/vitest.config.ts", "--json"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return (JSON.parse(listed) as unknown[]).length;
}

function testCountDrop(repo: string): string[] {
  const base = git(repo, "merge-base", "HEAD", "origin/main");
  const atBase = scratch();
  if (git(repo, "ls-tree", "-d", base, "core") !== "") {
    const archive = execFileSync("git", ["archive", base, "core"], { cwd: repo, env });
    execFileSync("tar", ["-x", "-C", atBase], { input: archive });
  }
  const before = testsIn(atBase);
  const now = testsIn(repo);
  return now < before ? [`core/ holds ${now} tests, below ${before} at the merge base ${base.slice(0, 12)}`] : [];
}

function unknownEnforcements(repo: string, registry: Part[], rules: SignedRule[]): string[] {
  const signed = new Set(rules.map((rule) => rule.text));
  const missing = registry.filter((part) => !existsSync(join(repo, part.file))).map((part) => `${part.name} names ${part.file}, which does not exist`);
  const unsigned = registry.flatMap((part) =>
    (part.holds ?? []).filter((rule) => !signed.has(rule)).map((rule) => `${part.name} holds a rule no signed page carries: ${rule}`),
  );
  return [...missing, ...unsigned];
}

const planted: Part = { name: "planted", file: "core/planted.ts", stops: "https://github.com/collod873/claude-workflow/issues/1" };

describe("the New core holds the charter's growth limits (ADR-0200)", () => {
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

  it("2. every registered part links the failure it stops, and every script under core/ is registered", () => {
    expect(unlinkedParts(REPO, parts)).toEqual([]);

    const copy = scratch();
    plant(copy, "core/bin/unregistered", "#!/bin/bash\n", 0o755);
    plant(copy, "core/planted.ts", "export {};\n");
    expect(unlinkedParts(copy, [{ ...planted, stops: "the owner said so" }])).toEqual([
      "core/bin/unregistered runs but is not a registered part",
      "planted links no failure: the owner said so",
    ]);
  });

  it("3. no workflow the core owns fires on a timer", () => {
    expect(timedWorkflows(REPO, parts)).toEqual([]);

    const copy = scratch();
    plant(copy, ".github/workflows/tick.yml", "on:\n  push:\n  schedule:\n    - cron: \"0 * * * *\"\njobs: {}\n");
    plant(copy, ".github/workflows/listed.yml", "on: [push, schedule]\njobs: {}\n");
    plant(copy, ".github/workflows/event.yml", "on: issues\njobs: {}\n");
    const workflows = ["tick", "listed", "event"].map((name) => ({ ...planted, name, file: `.github/workflows/${name}.yml` }));
    expect(timedWorkflows(copy, workflows)).toEqual(["tick fires on a timer", "listed fires on a timer"]);
  });

  it("4. the count of tests under core/ is not below the merge base with origin/main", () => {
    expect(testCountDrop(REPO)).toEqual([]);

    const copy = scratch();
    git(copy, "init", "--quiet", "--initial-branch=main");
    git(copy, "config", "user.email", "limits@test");
    git(copy, "config", "user.name", "limits");
    mkdirSync(join(copy, "core"));
    copyFileSync(join(REPO, "core", "vitest.config.ts"), join(copy, "core", "vitest.config.ts"));
    plant(copy, "core/kept.test.ts", "import { it } from \"vitest\";\nit(\"one\", () => {});\nit(\"two\", () => {});\n");
    git(copy, "add", "core");
    git(copy, "commit", "--quiet", "-m", "base");
    git(copy, "update-ref", "refs/remotes/origin/main", "HEAD");
    plant(copy, "core/kept.test.ts", "import { it } from \"vitest\";\nit(\"one\", () => {});\n");
    expect(testCountDrop(copy)).toEqual([expect.stringMatching(/^core\/ holds 1 tests, below 2 at the merge base [0-9a-f]{12}$/)]);
  });

  it("5. every registered enforcer names a rule a signed page carries, in a file that exists", () => {
    const rules = signedRules(REPO);
    expect(unknownEnforcements(REPO, parts, rules)).toEqual([]);

    const copy = scratch();
    const enforcer = { ...planted, holds: [rules[0].text, "A rule nobody signed"] };
    expect(unknownEnforcements(copy, [enforcer], rules)).toEqual([
      "planted names core/planted.ts, which does not exist",
      "planted holds a rule no signed page carries: A rule nobody signed",
    ]);
  });
});
