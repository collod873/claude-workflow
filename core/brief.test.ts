import { describe, expect, it } from "vitest";
import { CAP, brief } from "./brief.ts";

const TICKET = "722";
const CHECK = "npx vitest run --config core/vitest.config.ts brief";
const FILLER = "export const filler = 1;\n";

function ticketBody(claimed: string[]): string {
  return [
    "## Why",
    "",
    'The owner, in session: "an agent is handed what it needs, so it does not explore".',
    "",
    "## Acceptance criteria",
    "",
    `- [ ] The brief inlines what the claim carries - check: \`${CHECK}\``,
    "",
    "## Files claimed",
    "",
    ...claimed.map((path) => `- ${path}`),
    "",
  ].join("\n");
}

function reading(files: Record<string, string>) {
  return (path: string) => files[path];
}

const inlinedPaths = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("### ")).map((line) => line.slice(4));
const timesIn = (text: string, wanted: string): number => text.split(wanted).length - 1;

describe("the brief hands a stage what it needs, so it does not explore (#539)", () => {
  it("inlines each claimed file with its lines numbered", () => {
    const { text, refusals } = brief({
      ticket: TICKET,
      body: ticketBody(["core/planted.ts"]),
      tests: [],
      read: reading({ "core/planted.ts": "export const one = 1;\nexport const two = 2;\n" }),
    });

    expect(refusals).toEqual([]);
    expect(text).toContain("### core/planted.ts\n\n1  export const one = 1;\n2  export const two = 2;");
    expect(text).toContain(ticketBody(["core/planted.ts"]).trim());
  });

  it("widens the claim from the imports the claimed files really carry", () => {
    const { text } = brief({
      ticket: TICKET,
      body: ticketBody(["core/planted.ts"]),
      tests: [],
      read: reading({
        "core/planted.ts": 'import { helps } from "./helper.ts";\nimport { readFileSync } from "node:fs";\nimport { gone } from "./gone.ts";\n',
        "core/helper.ts": "export const helps = 1;\n",
        "core/unclaimed.ts": "export const unclaimed = 1;\n",
      }),
    });

    expect(inlinedPaths(text)).toEqual(["core/planted.ts", "core/helper.ts"]);
    expect(text).toContain("1  export const helps = 1;");
  });

  it("carries the acceptance test once, although the claim names it too", () => {
    const written = 'import { one } from "./planted.ts";\n';

    const { text } = brief({
      ticket: TICKET,
      body: ticketBody(["core/planted.ts", "core/planted.test.ts"]),
      tests: ["core/planted.test.ts"],
      read: reading({ "core/planted.test.ts": written, "core/planted.ts": "export const one = 1;\n" }),
    });

    expect(inlinedPaths(text)).toEqual(["core/planted.test.ts", "core/planted.ts"]);
    expect(timesIn(text, written)).toBe(1);
  });

  it("names a claimed file nothing has written yet", () => {
    const { text } = brief({ ticket: TICKET, body: ticketBody(["core/bin/planted"]), tests: [], read: reading({}) });

    expect(text).toContain("### core/bin/planted\n\n(not written yet)");
  });

  it("refuses a brief over the cap, biggest file first", () => {
    const { text, refusals } = brief({
      ticket: TICKET,
      body: ticketBody(["core/big.ts", "core/small.ts"]),
      tests: [],
      read: reading({ "core/big.ts": FILLER.repeat(3000), "core/small.ts": "export const small = 1;\n" }),
    });

    expect(text).toBe("");
    expect(refusals).toEqual([
      expect.stringMatching(new RegExp(`^the brief for ticket ${TICKET} is \\d{5,} bytes, over ${CAP}$`)),
      "core/big.ts inlines 75000 bytes",
      "core/small.ts inlines 24 bytes",
    ]);
  });
});
