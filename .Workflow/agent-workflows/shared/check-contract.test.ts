import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CheckContract,
  checkContractFixture,
  probe,
  resolveSlot,
  SLOT_NAMES,
} from "./check-contract";

const FIXTURES = resolve(import.meta.dirname, "check-contract.fixtures");

describe("the schema", () => {
  it("accepts every slot, a real cmd and the null opt-out both", () => {
    const contract = checkContractFixture({
      test: { cmd: "npm test", why: "package.json#scripts.test" },
    });

    expect(CheckContract.safeParse(contract).success).toBe(true);
    expect(contract.lint.cmd).toBeNull();
  });

  it("rejects a contract carrying a slot name the schema does not have", () => {
    const withInventedSlot = { ...checkContractFixture(), lint_one: { cmd: null, why: "invented" } };

    expect(CheckContract.safeParse(withInventedSlot).success).toBe(false);
  });

  it("rejects a contract missing one of its slots", () => {
    const missingStop: Record<string, unknown> = { ...checkContractFixture() };
    delete missingStop.stop;

    expect(CheckContract.safeParse(missingStop).success).toBe(false);
  });

  // Why the seventh slot is optional: `CheckContract`'s docstring in check-contract.ts (ADR-0143).
  it("accepts a contract written before test_related existed, degrading it to no turn-venue test run", () => {
    const sixSlot: Record<string, unknown> = { ...checkContractFixture() };
    delete sixSlot.test_related;

    const parsed = CheckContract.parse(sixSlot);

    expect(parsed.test_related.cmd).toBeNull();
    expect(parsed.test_related.why).toContain("absent from this contract");
  });

  it("keeps test_related the only optional slot — every other absence is still a failure", () => {
    for (const name of SLOT_NAMES.filter((slot) => slot !== "test_related")) {
      const missing: Record<string, unknown> = { ...checkContractFixture() };
      delete missing[name];

      expect(CheckContract.safeParse(missing).success).toBe(false);
    }
  });
});

describe("resolveSlot", () => {
  it("resolves a requested schema slot directly, unsubstituted", () => {
    const contract = checkContractFixture({ test: { cmd: "npm test", why: "declared" } });

    expect(resolveSlot(contract, "test")).toEqual({
      slot: "test",
      cmd: "npm test",
      substituted: false,
    });
  });

  it("degrades a form the schema has no slot for to the broader slot, reporting the substitution", () => {
    // The turn venue's actual gap (ADR-0056): it lints one file, and the schema has no
    // `lint_one`. No slot is invented — resolution runs `lint` instead and says so.
    const contract = checkContractFixture({ lint: { cmd: "npm run lint", why: "declared" } });

    expect(resolveSlot(contract, "lint_one")).toEqual({
      slot: "lint",
      cmd: "npm run lint",
      substituted: true,
      requested: "lint_one",
    });
  });

  it("resolves the turn venue's test form directly, never degrading it to the whole suite", () => {
    // #335: `test_related` is a slot rather than a `_one`-style narrowing precisely so that a
    // target without one runs *no* tests at the turn venue. Degrading it the way `lint_one`
    // degrades would put the whole suite on every PostToolUse hook.
    const contract = checkContractFixture({ test: { cmd: "npm test", why: "declared" } });

    expect(resolveSlot(contract, "test_related")).toEqual({
      slot: "test_related",
      cmd: null,
      substituted: false,
    });
  });

  it("throws rather than silently skipping a form with no slot and no broader form", () => {
    const contract = checkContractFixture();

    expect(() => resolveSlot(contract, "overnight")).toThrow();
  });
});

describe("probe", () => {
  it(
    "measures a non-null test slot even though the tree's own contract.json declares it null",
    () => {
      const contract = probe(join(FIXTURES, "stale-null-real-suite"));

      expect(contract.test.cmd).toBe("npx vitest run");
    },
  );

  it("names the runner's related-tests form for the turn venue where the runner has one", () => {
    const contract = probe(join(FIXTURES, "stale-null-real-suite"));

    expect(contract.test_related.cmd).toBe("npx vitest related --run <file>");
  });

  it("resolves lint to the biome invocation when the tree's linter is biome, not eslint", () => {
    const contract = probe(join(FIXTURES, "biome-linter"));

    expect(contract.lint.cmd).toBe("npx biome check .");
  });

  it("resolves every slot to null against a tree with no Node toolchain at all", () => {
    const contract = probe(join(FIXTURES, "no-node-toolchain"));

    for (const name of SLOT_NAMES) {
      expect(contract[name].cmd).toBeNull();
    }
  });

  it("asks in the target's own package manager, not npm, when its lockfile is pnpm's", () => {
    // Lumaria's tree carries `pnpm-lock.yaml` and no `package-lock.json` (ADR-0139): a probe that
    // wrote `npm run …` there published a contract its own `regenerate && diff` could never match.
    const contract = probe(join(FIXTURES, "pnpm-scripts"));

    expect(contract.typecheck.cmd).toBe("pnpm run typecheck");
    expect(contract.lint.cmd).toBe("pnpm run lint");
    expect(contract.test.cmd).toBe("pnpm test");
    expect(contract.all.cmd).toBe("pnpm run check");
  });
});

/**
 * #130: the probe used to test one hardcoded path for a turn-end check, so a repo whose Stop hook
 * lives anywhere else — including this one — published `stop: null` and had that certified by
 * `regenerate && diff`. These read the declaration site instead.
 *
 * #186: what it then published was the hook entry point, which no reader can run — a hook is
 * reached with its payload on stdin, and the same path as a plain command exits 0 having checked
 * nothing. So the hook is asked what check it runs, and a hook that will not say is a `null`.
 */
describe("probe's stop slot", () => {
  it("publishes the check the wired Stop hook declares, not the hook itself", () => {
    const contract = probe(join(FIXTURES, "stop-hook-in-settings"));

    expect(contract.stop.cmd).toBe("bin/gauntlet stop");
    expect(contract.stop.why).toContain(".claude/hooks/gauntlet.sh#check-command");
    expect(contract.stop.why).toContain(".claude/settings.json#hooks.Stop");
  });

  it("finds the hook file through the $CLAUDE_PROJECT_DIR the settings command is written against", () => {
    const settings = JSON.parse(
      readFileSync(join(FIXTURES, "stop-hook-in-settings/.claude/settings.json"), "utf8"),
    );

    // The declaration this probe has to see past to read the hook off disk at all.
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(
      '"$CLAUDE_PROJECT_DIR"/.claude/hooks/gauntlet.sh stop',
    );
    expect(probe(join(FIXTURES, "stop-hook-in-settings")).stop.cmd).toBe("bin/gauntlet stop");
  });

  it("publishes null for a wired hook that declares no check-command", () => {
    const contract = probe(join(FIXTURES, "stop-hook-undeclared"));

    expect(contract.stop.cmd).toBeNull();
    expect(contract.stop.why).toContain("check-command");
  });

  it("publishes null rather than an arbitrary first one when two command hooks are declared", () => {
    const contract = probe(join(FIXTURES, "two-stop-hooks"));

    expect(contract.stop.cmd).toBeNull();
    expect(contract.stop.why).toContain("2 command hooks");
  });

  it("falls back to the conventional stop-gate.sh's declaration when settings.json cannot be read", () => {
    const contract = probe(join(FIXTURES, "stop-gate-hook-only"));

    expect(contract.stop.cmd).toBe("bin/checks.sh");
    expect(contract.stop.why).toContain(".claude/hooks/stop-gate.sh#check-command");
  });

  it("publishes null when a tree declares no turn-end check either way", () => {
    const contract = probe(join(FIXTURES, "biome-linter"));

    expect(contract.stop.cmd).toBeNull();
  });
});
