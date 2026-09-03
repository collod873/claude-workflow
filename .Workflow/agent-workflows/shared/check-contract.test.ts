import { describe, expect, it } from "vitest";
import { CheckContract, checkContractFixture, resolveSlot, SLOT_NAMES } from "./check-contract";

describe("the schema", () => {
  it("accepts every slot, a real cmd and the null opt-out both", () => {
    const contract = checkContractFixture({
      test: { cmd: "make test", why: "Makefile#test" },
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
    const contract = checkContractFixture({ test: { cmd: "make test", why: "declared" } });

    expect(resolveSlot(contract, "test")).toEqual({
      slot: "test",
      cmd: "make test",
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
    const contract = checkContractFixture({ test: { cmd: "make test", why: "declared" } });

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
