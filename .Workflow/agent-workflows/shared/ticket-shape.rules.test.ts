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
