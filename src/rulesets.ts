import { execFileSync } from "node:child_process";
import { HOME_REVIEW } from "./enrol.ts";
import { FAST_CHECK } from "./fence.ts";
import { ENROLLED_REVIEW, MACHINE_REPO } from "./post.ts";

const HOME = MACHINE_REPO;
export const CHECK = FAST_CHECK;
export const REVIEW = ENROLLED_REVIEW;
export const ON_MAIN = ["pull_request", "non_fast_forward", "deletion", "required_status_checks"];

export interface Live {
  name: string;
  enforcement: string;
  conditions?: { ref_name?: { include?: string[] } };
  rules: { type: string; parameters?: { strict_required_status_checks_policy?: boolean; required_status_checks?: { context: string }[] } }[];
}

export interface Ruled {
  ref: string;
  rules: string[];
  checks: string[];
}

export const RULED: Record<string, Ruled> = {
  "main lands only through a PR": { ref: "~DEFAULT_BRANCH", rules: ON_MAIN, checks: [CHECK, REVIEW] },
};

function requiredIn(ruleset: Live): { contexts: string[]; strict: boolean } {
  const required = ruleset.rules.find((rule) => rule.type === "required_status_checks")?.parameters;
  return {
    contexts: (required?.required_status_checks ?? []).map(({ context }) => context),
    strict: required?.strict_required_status_checks_policy === true,
  };
}

export function refusals(live: Live[], appliesToMe: string[]): string[] {
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
      ...(strict ? [`${name} requires an up-to-date branch, which reruns the full check each time main moves (agent-hooks#176)`] : []),
    ];
  });
  const bypassed = ON_MAIN.filter((rule) => !appliesToMe.includes(rule)).map((rule) => `main's ${rule} rule does not apply to whoever is asking`);
  return [...configured, ...bypassed];
}

function gh(path: string): unknown {
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));
}

const swapped = (ruleset: Live): Live => ({
  ...ruleset,
  rules: ruleset.rules.map((rule) => (rule.parameters?.required_status_checks === undefined ? rule : { ...rule, parameters: { ...rule.parameters, required_status_checks: rule.parameters.required_status_checks.map(({ context }) => ({ context: context === HOME_REVIEW ? REVIEW : context })) } })),
});
const live = () => (gh(`repos/${HOME}/rulesets`) as { id: number }[]).map(({ id }) => swapped(gh(`repos/${HOME}/rulesets/${id}`) as Live));
const appliesToMe = () => (gh(`repos/${HOME}/rules/branches/main`) as { type: string }[]).map(({ type }) => type);

export const asRuled = (name: string, ruled: Ruled): Live => ({
  name,
  enforcement: "active",
  conditions: { ref_name: { include: [ruled.ref] } },
  rules: ruled.rules.map((type) =>
    type === "required_status_checks"
      ? { type, parameters: { strict_required_status_checks_policy: false, required_status_checks: ruled.checks.map((context) => ({ context })) } }
      : { type },
  ),
});

if (import.meta.main) {
  const refused = refusals(live(), appliesToMe());
  for (const refusal of refused) console.log(refusal);
  process.exit(refused.length > 0 ? 1 : 0);
}
