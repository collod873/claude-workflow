import { describe, expect, it } from "vitest";
import { asRuled, CHECK, ON_MAIN, refusals, RULED } from "./rulesets.ts";

describe("GitHub holds main, and this reads the ruleset it holds it with (#652)", () => {
  it("names a ruleset that is missing, switched off, weakened, bypassed, or requiring an up-to-date branch", () => {
    const [main] = Object.entries(RULED).map(([name, ruled]) => asRuled(name, ruled));
    if (main === undefined) throw new Error("no ruleset in RULED");

    expect(refusals([main], ON_MAIN)).toEqual([]);
    expect(refusals([], ON_MAIN)).toEqual(["no ruleset named main lands only through a PR"]);
    expect(refusals([{ ...main, enforcement: "evaluate" }], ON_MAIN)).toEqual(["main lands only through a PR is evaluate, not active"]);
    expect(refusals([{ ...main, rules: main.rules.filter((rule) => rule.type !== "non_fast_forward") }], ON_MAIN)).toEqual([
      "main lands only through a PR holds no non_fast_forward rule",
    ]);
    expect(refusals([{ ...main, rules: main.rules.map((rule) => (rule.type === "required_status_checks" ? { ...rule, parameters: {} } : rule)) }], ON_MAIN)).toEqual([
      `main lands only through a PR requires no check, not ${CHECK}`,
    ]);
    expect(refusals([{ ...main, rules: main.rules.map((rule) => (rule.type === "required_status_checks" ? { ...rule, parameters: { ...rule.parameters, strict_required_status_checks_policy: true } } : rule)) }], ON_MAIN)).toEqual([
      "main lands only through a PR requires an up-to-date branch, which reruns the full check each time main moves (agent-hooks#176)",
    ]);
    expect(refusals([main], ["pull_request", "deletion"])).toEqual([
      "main's non_fast_forward rule does not apply to whoever is asking",
      "main's required_status_checks rule does not apply to whoever is asking",
    ]);
  });
});
