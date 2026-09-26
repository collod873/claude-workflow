import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HOME = "collod873/claude-workflow";
const CHECK = "check";
const REVIEW = "review";
const ON_MAIN = ["pull_request", "non_fast_forward", "deletion", "required_status_checks"];

interface Live {
  name: string;
  enforcement: string;
  conditions?: { ref_name?: { include?: string[] } };
  rules: { type: string; parameters?: { strict_required_status_checks_policy?: boolean; required_status_checks?: { context: string }[] } }[];
}

interface Ruled {
  ref: string;
  rules: string[];
  checks: string[];
}

const RULED: Record<string, Ruled> = {
  "main lands only through a PR": { ref: "~DEFAULT_BRANCH", rules: ON_MAIN, checks: [CHECK, REVIEW] },
};

function requiredIn(ruleset: Live): { contexts: string[]; strict: boolean } {
  const required = ruleset.rules.find((rule) => rule.type === "required_status_checks")?.parameters;
  return {
    contexts: (required?.required_status_checks ?? []).map(({ context }) => context),
    strict: required?.strict_required_status_checks_policy === true,
  };
}

function refusals(live: Live[], appliesToMe: string[]): string[] {
  const configured = Object.entries(RULED).flatMap(([name, ruled]) => {
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
    ];
  });
  const bypassed = ON_MAIN.filter((rule) => !appliesToMe.includes(rule)).map((rule) => `main's ${rule} rule does not apply to whoever is asking`);
  return [...configured, ...bypassed];
}

function gh(path: string): unknown {
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));
}

const live = () => (gh(`repos/${HOME}/rulesets`) as { id: number }[]).map(({ id }) => gh(`repos/${HOME}/rulesets/${id}`) as Live);
const appliesToMe = () => (gh(`repos/${HOME}/rules/branches/main`) as { type: string }[]).map(({ type }) => type);

const asRuled = (name: string, ruled: Ruled): Live => ({
  name,
  enforcement: "active",
  conditions: { ref_name: { include: [ruled.ref] } },
  rules: ruled.rules.map((type) =>
    type === "required_status_checks"
      ? { type, parameters: { strict_required_status_checks_policy: true, required_status_checks: ruled.checks.map((context) => ({ context })) } }
      : { type },
  ),
});

describe("GitHub holds main, and this reads the ruleset it holds it with (#652)", () => {
  it("finds every rule main needs, and none of them bypassed for whoever runs this", () => {
    expect(refusals(live(), appliesToMe())).toEqual([]);
  });

  it("names a ruleset that is missing, switched off, weakened, or bypassed", () => {
    const [main] = Object.entries(RULED).map(([name, ruled]) => asRuled(name, ruled));
    if (main === undefined) throw new Error("no ruleset in RULED");

    expect(refusals([main], ON_MAIN)).toEqual([]);
    expect(refusals([], ON_MAIN)).toEqual(["no ruleset named main lands only through a PR"]);
    expect(refusals([{ ...main, enforcement: "evaluate" }], ON_MAIN)).toEqual(["main lands only through a PR is evaluate, not active"]);
    expect(refusals([{ ...main, rules: main.rules.filter((rule) => rule.type !== "non_fast_forward") }], ON_MAIN)).toEqual([
      "main lands only through a PR holds no non_fast_forward rule",
    ]);
    expect(refusals([{ ...main, rules: main.rules.map((rule) => (rule.type === "required_status_checks" ? { ...rule, parameters: {} } : rule)) }], ON_MAIN)).toEqual([
      `main lands only through a PR requires no check, not ${CHECK},${REVIEW}`,
      "main lands only through a PR takes a branch behind main",
    ]);
    expect(refusals([main], ["pull_request", "deletion"])).toEqual([
      "main's non_fast_forward rule does not apply to whoever is asking",
      "main's required_status_checks rule does not apply to whoever is asking",
    ]);
  });
});
