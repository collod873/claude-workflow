import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const rules = JSON.parse(
  readFileSync(".Workflow/agent-workflows/shared/ticket-shape.rules.json", "utf-8")
) as Record<string, number>;

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function numberWords(value: number): string[] {
  if (!Number.isInteger(value) || value < 0 || value >= 100) return [];
  if (value < 20) return [ONES[value]];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones === 0 ? [TENS[tens]] : [`${TENS[tens]}-${ONES[ones]}`, `${TENS[tens]} ${ONES[ones]}`];
}

const CEILING_SIGNAL = /\b(at most|no more than|more than|less than|up to|max(?:imum)?|limit|ceiling|cap|fits|hard one|past|over|exceeds?)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLiteralCeilings(text: string, rulesFile: Record<string, number>): string[] {
  const violations: string[] = [];
  const lines = text.split(/\r\n|\n/);

  for (const [key, value] of Object.entries(rulesFile)) {
    if (typeof value !== "number") continue;
    const forms = [String(value), ...numberWords(value)].map(escapeRegExp);
    const valuePattern = new RegExp(`\\b(${forms.join("|")})\\b`, "i");

    lines.forEach((line, index) => {
      if (line.includes(key)) return;
      if (!valuePattern.test(line)) return;
      if (!CEILING_SIGNAL.test(line)) return;
      violations.push(`${key}=${value} at line ${index + 1}: ${line.trim()}`);
    });
  }

  return violations;
}

function findLiteralCeilingsInFiles(paths: string[], rulesFile: Record<string, number>): string[] {
  return paths.flatMap((path) =>
    findLiteralCeilings(readFileSync(path, "utf-8"), rulesFile).map((violation) => `${path}: ${violation}`)
  );
}

test("#583.1: a gate under the test slot fails when a ticket-shape.rules.json value is stated as a ceiling in prose", () => {
  const text = `filesClaimed has a hard one: **at most ${rules.claimLimit} paths**`;
  const violations = findLiteralCeilings(text, rules);
  expect(violations.length).toBeGreaterThan(0);
});

test("#583.2: the gate reads the values from ticket-shape.rules.json rather than carrying its own copy", () => {
  const customRules = { ...rules, claimLimit: 3 };
  const text = "filesClaimed has a hard one: at most 3 paths";
  const violations = findLiteralCeilings(text, customRules);
  expect(violations.length).toBeGreaterThan(0);
});

test("#583.3: neither to-tickets prompt spells the claim ceiling", () => {
  const violations = findLiteralCeilingsInFiles(
    [
      ".Workflow/agent-workflows/to-tickets/slice/prompt.md",
      ".Workflow/agent-workflows/to-tickets/audit/prompt.md",
    ],
    rules
  );
  expect(violations).toHaveLength(0);
});
