import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { MACHINE_ROOT } from "./run-gauntlet.ts";
import { scratchDir } from "./scratch.fixture.ts";

const LANDING_VENUES = ["turn", "stop", "push"] as const;

const STUBBED_CONTRACT = {
  typecheck: { cmd: "true" },
  lint: { cmd: "eslint ." },
  lint_one: { cmd: "eslint <file>" },
  test: { cmd: "true" },
  test_related: { cmd: "true" },
  clones: { cmd: "true" },
  adrs: { cmd: "true" },
};

function eslintInvocations(venue: (typeof LANDING_VENUES)[number]): string[] {
  const root = scratchDir(`gauntlet-autofix-${venue}`);
  const shimDir = join(root, "shim");
  const target = join(root, "target");
  mkdirSync(shimDir, { recursive: true });
  mkdirSync(target, { recursive: true });

  const log = join(root, "eslint-invocations.log");
  const shim = join(shimDir, "eslint");
  writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`);
  chmodSync(shim, 0o755);

  const contract = join(root, "contract.json");
  writeFileSync(contract, JSON.stringify(STUBBED_CONTRACT));
  writeFileSync(join(target, "fixable.ts"), "export const fixable = 'fixable'\n");
  execFileSync("git", ["init", "-q"], { cwd: target, stdio: ["pipe", "pipe", "pipe"] });

  execFileSync(join(MACHINE_ROOT, "bin/gauntlet"), venue === "turn" ? [venue, "fixable.ts"] : [venue], {
    cwd: MACHINE_ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
      TARGET_WORKSPACE: target,
      GAUNTLET_CONTRACT: contract,
      GAUNTLET_LOCK: join(root, "push.lock"),
    },
  });

  return existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
    : [];
}

test(
  "#490.1: bin/gauntlet runs the lint slot's eslint with --fix before reporting, in the turn, stop and push venues",
  () => {
    for (const venue of LANDING_VENUES) {
      const invocations = eslintInvocations(venue);

      expect(invocations.length).toBeGreaterThan(0);
      expect(invocations.filter((line) => line.split(/\s+/).includes("--fix")).length).toBeGreaterThan(0);
    }
  },
  600_000,
);
