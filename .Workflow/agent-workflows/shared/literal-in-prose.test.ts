import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const rules = JSON.parse(
  readFileSync(".Workflow/agent-workflows/shared/ticket-shape.rules.json", "utf-8")
) as Record<string, number>;

function findLiteralCeilings(text: string, rulesFile: Record<string, number>): string[] {
  throw new Error("#583: not built");
}

function findLiteralCeilingsInFiles(paths: string[], rulesFile: Record<string, number>): string[] {
  throw new Error("#583: not built");
}

test.fails("#583.1: a gate under the test slot fails when a ticket-shape.rules.json value is stated as a ceiling in prose", () => {
  const text = `filesClaimed has a hard one: **at most ${rules.claimLimit} paths**`;
  const violations = findLiteralCeilings(text, rules);
  expect(violations.length).toBeGreaterThan(0);
});

test.fails("#583.2: the gate reads the values from ticket-shape.rules.json rather than carrying its own copy", () => {
  const customRules = { ...rules, claimLimit: 3 };
  const text = "filesClaimed has a hard one: at most 3 paths";
  const violations = findLiteralCeilings(text, customRules);
  expect(violations.length).toBeGreaterThan(0);
});

test.fails("#583.3: neither to-tickets prompt spells the claim ceiling", () => {
  const violations = findLiteralCeilingsInFiles(
    [
      ".Workflow/agent-workflows/to-tickets/slice/prompt.md",
      ".Workflow/agent-workflows/to-tickets/audit/prompt.md",
    ],
    rules
  );
  expect(violations).toHaveLength(0);
});
