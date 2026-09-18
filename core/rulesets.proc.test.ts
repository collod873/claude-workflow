import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HOME = "collod873/claude-workflow";
const CHECK = "core-check / core-check";

interface Live {
  name: string;
  enforcement: string;
  conditions?: { ref_name?: { include?: string[] } };
  bypass_actors?: { actor_type: string; bypass_mode: string }[];
  rules: { type: string; parameters?: { strict_required_status_checks_policy?: boolean; required_status_checks?: { context: string }[] } }[];
}

interface Ruled {
  ref: string;
  rules: string[];
  checks: string[];
  bypass: string[];
}

const RULED: Record<string, Ruled> = {
  "main lands only through a PR": {
    ref: "~DEFAULT_BRANCH",
    rules: ["pull_request", "non_fast_forward", "deletion", "required_status_checks"],
    checks: [CHECK],
    bypass: [],
  },
  "stable tag moves only by the App": {
    ref: "refs/tags/stable",
    rules: ["creation", "update", "deletion", "non_fast_forward"],
    checks: [],
    bypass: ["Integration"],
  },
};

function requiredIn(ruleset: Live): { contexts: string[]; strict: boolean } {
  const required = ruleset.rules.find((rule) => rule.type === "required_status_checks")?.parameters;
  return {
    contexts: (required?.required_status_checks ?? []).map(({ context }) => context),
    strict: required?.strict_required_status_checks_policy === true,
  };
}

function refusals(live: Live[]): string[] {
  return Object.entries(RULED).flatMap(([name, ruled]) => {
    const ruleset = live.find((one) => one.name === name);
    if (ruleset === undefined) return [`no ruleset named ${name}`];
    const { contexts, strict } = requiredIn(ruleset);
    const held = new Set(ruleset.rules.map((rule) => rule.type));
    return [
      ...(ruleset.enforcement === "active" ? [] : [`${name} is ${ruleset.enforcement}, not active`]),
      ...(ruleset.conditions?.ref_name?.include?.includes(ruled.ref) === true ? [] : [`${name} does not cover ${ruled.ref}`]),
      ...ruled.rules.filter((rule) => !held.has(rule)).map((rule) => `${name} holds no ${rule} rule`),
      ...(contexts.join() === ruled.checks.join() ? [] : [`${name} requires ${contexts.join() || "no check"}, not ${ruled.checks.join() || "no check"}`]),
      ...(ruled.checks.length > 0 && !strict ? [`${name} takes a branch behind main`] : []),
      ...((ruleset.bypass_actors ?? []).map(({ actor_type }) => actor_type).join() === ruled.bypass.join()
        ? []
        : [`${name} is bypassed by ${(ruleset.bypass_actors ?? []).map(({ actor_type }) => actor_type).join() || "nobody"}, not ${ruled.bypass.join() || "nobody"}`]),
    ];
  });
}

function live(): Live[] {
  const gh = (path: string) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" })) as unknown;
  return (gh(`repos/${HOME}/rulesets`) as { id: number }[]).map(({ id }) => gh(`repos/${HOME}/rulesets/${id}`) as Live);
}

const asRuled = (name: string, ruled: Ruled): Live => ({
  name,
  enforcement: "active",
  conditions: { ref_name: { include: [ruled.ref] } },
  bypass_actors: ruled.bypass.map((actor_type) => ({ actor_type, bypass_mode: "always" })),
  rules: ruled.rules.map((type) =>
    type === "required_status_checks"
      ? { type, parameters: { strict_required_status_checks_policy: true, required_status_checks: ruled.checks.map((context) => ({ context })) } }
      : { type },
  ),
});

describe("GitHub holds main and the stable tag, and this reads the rulesets it holds them with (#652)", () => {
  it("finds every rule the One ticket ruling names on the live rulesets", () => {
    expect(refusals(live())).toEqual([]);
  });

  it("names a ruleset that is missing, switched off, weakened, or bypassed", () => {
    const [main, tag] = Object.entries(RULED).map(([name, ruled]) => asRuled(name, ruled));

    expect(refusals([main, tag])).toEqual([]);
    expect(refusals([tag])).toEqual(["no ruleset named main lands only through a PR"]);
    expect(refusals([{ ...main, enforcement: "evaluate" }, tag])).toEqual(["main lands only through a PR is evaluate, not active"]);
    expect(refusals([{ ...main, rules: main.rules.filter((rule) => rule.type !== "non_fast_forward") }, tag])).toEqual([
      "main lands only through a PR holds no non_fast_forward rule",
    ]);
    expect(refusals([{ ...main, rules: main.rules.map((rule) => (rule.type === "required_status_checks" ? { ...rule, parameters: {} } : rule)) }, tag])).toEqual([
      `main lands only through a PR requires no check, not ${CHECK}`,
      "main lands only through a PR takes a branch behind main",
    ]);
    expect(refusals([{ ...main, bypass_actors: [{ actor_type: "OrganizationAdmin", bypass_mode: "always" }] }, tag])).toEqual([
      "main lands only through a PR is bypassed by OrganizationAdmin, not nobody",
    ]);
    expect(refusals([main, { ...tag, bypass_actors: [] }])).toEqual(["stable tag moves only by the App is bypassed by nobody, not Integration"]);
  });
});
