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
  it("accepts the six slots, a real cmd and the null opt-out both", () => {
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

  it("rejects a contract missing one of the six slots", () => {
    const missingStop: Record<string, unknown> = { ...checkContractFixture() };
    delete missingStop.stop;

    expect(CheckContract.safeParse(missingStop).success).toBe(false);
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
    // The turn venue's actual gap (ADR-0056): it lints one file, and the six-slot schema has no
    // `lint_one`. No slot is invented — resolution runs `lint` instead and says so.
    const contract = checkContractFixture({ lint: { cmd: "npm run lint", why: "declared" } });

    expect(resolveSlot(contract, "lint_one")).toEqual({
      slot: "lint",
      cmd: "npm run lint",
      substituted: true,
      requested: "lint_one",
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
});
