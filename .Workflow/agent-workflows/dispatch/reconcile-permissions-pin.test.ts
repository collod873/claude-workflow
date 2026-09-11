import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkflow } from "../shared/read-workflow";
import { readRepoText, REPO_ROOT } from "../shared/repo-sources";

const RESTATEMENT = /single job holding `([^`]+)` throughout/;

const walkthrough = () => readRepoText(join(REPO_ROOT, "docs/agents/reconcile-lane-edges.md"));

function restatedPermissions(): Record<string, string> | undefined {
  const literal = RESTATEMENT.exec(walkthrough())?.[1];
  if (literal === undefined) return undefined;
  const pairs = literal.split(", ").map((pair) => pair.split(": "));
  const spelled = pairs.every((pair) => pair.length === 2 && pair.every((half) => /^[a-z-]+$/.test(half)));
  return spelled ? Object.fromEntries(pairs as [string, string][]) : undefined;
}

function declaredPermissions(): Record<string, string> | undefined {
  return readWorkflow<{ permissions?: Record<string, string> }>("dispatch-reconcile.yml").workflow.permissions;
}

describe("the reconcile walkthrough's permissions prose agrees with the dispatch-reconcile.yml block it is a copy of", () => {
  it("finds a permissions literal in each text, so this pin is not vacuous", () => {
    expect(restatedPermissions(), "the walkthrough's backticked permissions span").toBeDefined();
    expect(declaredPermissions(), "dispatch-reconcile.yml's permissions: block").toBeDefined();
  });

  it("names exactly the scopes the workflow grants, at exactly the levels it grants them", () => {
    expect(restatedPermissions()).toEqual(declaredPermissions());
  });
});
