import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const rulesPath = fileURLToPath(new URL("./ticket-shape.rules.json", import.meta.url));

test("#552.3: ticket-shape.rules.json carries that ADR's number against the evidence grammar", () => {
  const rules = JSON.parse(readFileSync(rulesPath, "utf8"));

  expect(Object.keys(rules.grammar)).toEqual(
    expect.arrayContaining(["checkMarker", "checkMarkerAttempt"]),
  );
  expect(rules.fragments.checkMarkerDelim).toBeTypeOf("string");
  expect(JSON.stringify(rules)).toMatch(/ADR-\d{4}/);
});

test(
  "#579.2: the Files claimed glob refusal string lives in ticket-shape.rules.json's refusals, beside the others, not inline",
  () => {
    const rules = JSON.parse(readFileSync(rulesPath, "utf8"));

    const refusalEntries = Object.entries(rules.refusals as Record<string, unknown>);
    const globRefusal = refusalEntries.find(
      ([, value]) => typeof value === "string" && /one file/i.test(value),
    );

    expect(globRefusal).toBeDefined();
    expect(globRefusal?.[1]).toMatch(/\{[^}]+\}/);
  },
);
