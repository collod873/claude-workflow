import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "..");
const WORKFLOWS = ".github/workflows";
const ROUTES_CORE = /collod873\/claude-workflow\/\.github\/workflows\/core-[\w.-]+\.ya?ml@/;
const AT_STABLE = /^collod873\/claude-workflow\/\.github\/workflows\/[\w.-]+\.ya?ml@stable$/;
const STUB_CARRIES = ["name", "on", "jobs"];
const JOB_CARRIES = ["uses", "secrets", "permissions"];

interface Stub {
  file: string;
  source: string;
}

function coreStubs(repo: string): Stub[] {
  return readdirSync(join(repo, WORKFLOWS))
    .map((name) => ({ file: `${WORKFLOWS}/${name}`, source: readFileSync(join(repo, WORKFLOWS, name), "utf8") }))
    .filter(({ source }) => ROUTES_CORE.test(source));
}

function triggersOf(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on as string[];
  return Object.keys((on ?? {}) as object);
}

function loosenedJob(file: string, name: string, job: Record<string, unknown>): string[] {
  const uses = typeof job.uses === "string" ? job.uses : "no uses:";
  return [
    ...Object.keys(job)
      .filter((key) => !JOB_CARRIES.includes(key))
      .map((key) => `${file} job ${name} carries ${key}, beyond a uses: at @stable`),
    ...(AT_STABLE.test(uses) ? [] : [`${file} job ${name} is no uses: at @stable: ${uses}`]),
    ...(job.secrets === undefined || job.secrets === "inherit" ? [] : [`${file} job ${name} passes secrets by hand, not inherit`]),
  ];
}

function loosened({ file, source }: Stub): string[] {
  const stub = (parse(source) ?? {}) as Record<string, unknown>;
  const jobs = (stub.jobs ?? {}) as Record<string, Record<string, unknown>>;
  const triggers = triggersOf(stub.on);
  const names = Object.keys(jobs);
  return [
    ...Object.keys(stub)
      .filter((key) => !STUB_CARRIES.includes(key))
      .map((key) => `${file} carries ${key}, beyond its trigger and its uses:`),
    ...(triggers.length === 1 ? [] : [`${file} fires on ${triggers.length} triggers`]),
    ...(names.length === 1 ? [] : [`${file} routes through ${names.length} jobs`]),
    ...names.flatMap((name) => loosenedJob(file, name, jobs[name])),
  ];
}

const loose = [
  "name: Core check",
  '"on":',
  "  pull_request_target:",
  "  push:",
  "env:",
  "  WHO: the caller",
  "jobs:",
  "  core-check:",
  "    uses: collod873/claude-workflow/.github/workflows/core-check.yml@main",
  "    if: github.actor != 'nobody'",
  "    secrets:",
  "      key: ${{ secrets.CORE_APP_PRIVATE_KEY }}",
  "",
].join("\n");

const tight = [
  '"on":',
  "  issues:",
  "    types: [opened]",
  "jobs:",
  "  start:",
  "    uses: collod873/claude-workflow/.github/workflows/core-start.yml@stable",
  "    secrets: inherit",
  "",
].join("\n");

describe("a stub carries one trigger and a uses: at @stable, so a PR cannot loosen the stub that routes it (#711)", () => {
  it("reads the stubs that route this repo into the core, so an empty scan cannot pass", () => {
    expect(coreStubs(REPO).map(({ file }) => file)).toContain(`${WORKFLOWS}/core-check-caller.yml`);
  });

  it("holds every stub in the repo to the shape", () => {
    expect(coreStubs(REPO).flatMap(loosened)).toEqual([]);
  });

  it("refuses a stub carrying a second trigger, a setting, a job step or a ref that is not @stable", () => {
    expect(loosened({ file: "loose.yml", source: loose })).toEqual([
      "loose.yml carries env, beyond its trigger and its uses:",
      "loose.yml fires on 2 triggers",
      "loose.yml job core-check carries if, beyond a uses: at @stable",
      "loose.yml job core-check is no uses: at @stable: collod873/claude-workflow/.github/workflows/core-check.yml@main",
      "loose.yml job core-check passes secrets by hand, not inherit",
    ]);
  });

  it("takes a stub that is a trigger, a uses: at @stable, and the secrets it passes through", () => {
    expect(loosened({ file: "tight.yml", source: tight })).toEqual([]);
  });
});
