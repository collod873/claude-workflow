import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { readRepoText } from "../../.Workflow/agent-workflows/shared/repo-sources";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HOOKS, "../..");
const LINT = join(REPO_ROOT, "bin/lint");

const LIVE_SLUGS = [
  "adr-corpus",
  "bare-bin-path",
  "bare-hooks-path",
  "duplicated-code/append-log-swallow",
  "duplicated-code/deny-envelope",
  "duplicated-code/deny-envelope-asserted-per-harness",
  "duplicated-code/edit-tool-roster",
  "duplicated-code/hook-helper-tested-through-hook-harnesses",
  "duplicated-code/hooks-bin-sys-path-splice",
  "duplicated-code/stdin-payload-read",
  "duplicated-code/subagent-dispatch-convention-restated",
  "duplicated-code/subprocess-magic-timeout",
  "duplicated-code/test-malformed-stdin-fixture",
  "duplicated-code/test-run-hook-subprocess",
];

interface ContractSlot {
  cmd?: string;
}

interface VenueSlots {
  venue: string;
  slots: string[];
}

function repoText(relativePath: string): string {
  return readRepoText(join(REPO_ROOT, relativePath));
}

test("#587.1: a venue runs bin/lint: a contract slot names it and the push venue lists that slot", () => {
  const contract = JSON.parse(repoText(".claude/contract.json")) as Record<string, ContractSlot | null>;
  const venues = JSON.parse(repoText(".Workflow/agent-workflows/shared/venue-slots.json")) as VenueSlots[];

  const running = Object.entries(contract)
    .filter(([, slot]) => typeof slot?.cmd === "string" && slot.cmd.includes("bin/lint"))
    .map(([name]) => name);
  expect(running.length).toBeGreaterThan(0);

  const push = venues.find((entry) => entry.venue === "push")?.slots ?? [];
  expect(running.some((name) => push.includes(name))).toBe(true);
});

test("#587.2: a violation in the tree fails the venue slot while test_lint.py stays green, so the gate reports as a lint finding", () => {
  const trip = join(HOOKS, "_lint_venue_trip.py");
  writeFileSync(trip, '#!/usr/bin/env python3\nPAYLOAD = {"permissionDecision": "deny"}\n', "utf8");
  try {
    const slot = spawnSync(LINT, [], { encoding: "utf8", cwd: REPO_ROOT });
    const harness = spawnSync("python3", [join(HOOKS, "test_lint.py")], { encoding: "utf8", cwd: REPO_ROOT });

    expect(slot.status).toBe(1);
    expect(harness.status).toBe(0);
  } finally {
    rmSync(trip, { force: true });
  }
});

test("#587.3: bin/lint carries only the slugs with a recorded fire or an ADR naming them as its enforcement", () => {
  const slugs = [...repoText("bin/lint").matchAll(/rule "([^"]+)"/g)].map((match) => match[1]);

  expect([...new Set(slugs)].sort()).toEqual([...LIVE_SLUGS].sort());
});

test("#587.4: the ticket-format check-marker example no longer hands a path to bin/lint, which ignores its arguments", () => {
  expect(repoText("docs/agents/ticket-format.md")).not.toContain("bin/lint path/to/file");
});

test("#587.5: ADR-0174 no longer claims bin/lint holds every ratified standard while no venue runs it", () => {
  const adr = repoText("docs/adr/0174-a-ratified-standard-must-be-expressible-as-a-sub-second-grep.md");

  expect(adr).not.toContain("holds every standard this repo ratified");
  expect(adr).toMatch(/contract\.json|slot/);
});
