import { describe, expect, it } from "vitest";
import { CAP, brief } from "./brief.ts";
import { ticketRefusals } from "./ticket-shape.ts";

const TICKET = "722";
const CHECK = "npx vitest run --config vitest.config.ts brief";
const FILLER = "export const filler = 1;\n";

function ticketBody(claimed: string[], toRead: string[] = []): string {
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
    ...(toRead.length === 0 ? [] : ["## Files to read", "", ...toRead.map((path) => `- ${path}`), ""]),
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
      body: ticketBody(["src/planted.ts"]),
      tests: [],
      read: reading({ "src/planted.ts": "export const one = 1;\nexport const two = 2;\n" }),
    });

    expect(refusals).toEqual([]);
    expect(text).toContain("### src/planted.ts\n\n1  export const one = 1;\n2  export const two = 2;");
    expect(text).toContain(ticketBody(["src/planted.ts"]).trim());
  });

  it("widens the claim from the imports the claimed files really carry", () => {
    const { text } = brief({
      ticket: TICKET,
      body: ticketBody(["src/planted.ts"]),
      tests: [],
      read: reading({
        "src/planted.ts": 'import { helps } from "./helper.ts";\nimport { readFileSync } from "node:fs";\nimport { gone } from "./gone.ts";\n',
        "src/helper.ts": "export const helps = 1;\n",
        "src/unclaimed.ts": "export const unclaimed = 1;\n",
      }),
    });

    expect(inlinedPaths(text)).toEqual(["src/planted.ts", "src/helper.ts"]);
    expect(text).toContain("1  export const helps = 1;");
  });

  it("carries the acceptance test once, although the claim names it too", () => {
    const written = 'import { one } from "./planted.ts";\n';

    const { text } = brief({
      ticket: TICKET,
      body: ticketBody(["src/planted.ts", "src/planted.test.ts"]),
      tests: ["src/planted.test.ts"],
      read: reading({ "src/planted.test.ts": written, "src/planted.ts": "export const one = 1;\n" }),
    });

    expect(inlinedPaths(text)).toEqual(["src/planted.test.ts", "src/planted.ts"]);
    expect(timesIn(text, written)).toBe(1);
  });

  it("names a claimed file nothing has written yet", () => {
    const { text } = brief({ ticket: TICKET, body: ticketBody(["bin/planted"]), tests: [], read: reading({}) });

    expect(text).toContain("### bin/planted\n\n(not written yet)");
  });

  it("every brief carries src/scenarios.ts and vitest.config.ts, once each", () => {
    const { text } = brief({
      ticket: TICKET,
      body: ticketBody(["src/planted.ts"]),
      tests: [],
      read: reading({
        "src/planted.ts": "export const one = 1;\n",
        "src/scenarios.ts": "export const scratch = 1;\n",
        "vitest.config.ts": "export default {};\n",
      }),
    });

    expect(timesIn(text, "### src/scenarios.ts")).toBe(1);
    expect(timesIn(text, "### vitest.config.ts")).toBe(1);
  });

  it("inlines a ticket's '## Files to read' with line numbers, and refuses a glob there at filing", () => {
    const { text } = brief({
      ticket: TICKET,
      body: ticketBody(["src/planted.ts"], ["src/other.ts"]),
      tests: [],
      read: reading({
        "src/planted.ts": "export const one = 1;\n",
        "src/other.ts": "export const other = 1;\nexport const two = 2;\n",
      }),
    });

    expect(text).toContain("### src/other.ts\n\n1  export const other = 1;\n2  export const two = 2;");
    expect(ticketRefusals(ticketBody(["src/planted.ts"], ["src/*.ts"]))).toEqual(["'## Files to read' names `src/*.ts`, a glob rather than one file"]);
  });

  it("refuses a brief over the cap, biggest file first", () => {
    const { text, refusals } = brief({
      ticket: TICKET,
      body: ticketBody(["src/big.ts", "src/small.ts"]),
      tests: [],
      read: reading({ "src/big.ts": FILLER.repeat(6000), "src/small.ts": "export const small = 1;\n" }),
    });

    expect(text).toBe("");
    expect(refusals).toEqual([
      expect.stringMatching(new RegExp(`^the brief for ticket ${TICKET} is \\d{5,} bytes, over ${CAP}$`)),
      "src/big.ts inlines 150000 bytes",
      "src/small.ts inlines 24 bytes",
    ]);
  });
});
