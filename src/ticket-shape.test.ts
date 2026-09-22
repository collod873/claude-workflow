import { describe, expect, it } from "vitest";
import { noteRefusals, ticketRefusals } from "./ticket-shape.ts";

const DASH = "\u2014";
const LINE = 200;
const TEST_CHECK = "npx vitest run --config vitest.config.ts ticket-shape";
const GREP_CHECK = "grep -q ticketRefusals src/post.ts";
const QUOTED = 'The owner, in session: "file a ticket the machine can build".';

function body({
  why = QUOTED,
  criteria = [`- [ ] The shape refuses a body carrying no why - check: \`${TEST_CHECK}\``],
  claimed = ["- src/ticket-shape.ts"],
}: { why?: string; criteria?: string[]; claimed?: string[] } = {}): string {
  return ["## Why", "", why, "", "## Acceptance criteria", "", ...criteria, "", "## Files claimed", "", ...claimed, ""].join("\n");
}

const criterion = (says: string, check: string) => `- [ ] ${says} - check: \`${check}\``;

const misshapen: [string, string, unknown[]][] = [
  ["a body with no '## Why'", body().replace("## Why", "## Background"), ["the body carries no '## Why', so nothing says what the owner asked for"]],
  [
    "a '## Why' quoting no owner words",
    body({ why: "The session decided this would be worth building." }),
    ["'## Why' quotes no owner words: it carries no \"...\" quote and no > quoted line"],
  ],
  ["a body with no '## Acceptance criteria'", body().replace("## Acceptance criteria", "## Plan"), ["the body carries no '## Acceptance criteria'"]],
  [
    "a heading whose items are plain bullets",
    body({ criteria: [`- The shape refuses a body - check: \`${TEST_CHECK}\``] }),
    ["'## Acceptance criteria' carries 0 '- [ ]' items, not 1 to 3"],
  ],
  [
    "four criteria",
    body({ criteria: [1, 2, 3, 4].map((n) => criterion(`The shape refuses defect ${n}`, TEST_CHECK)) }),
    ["'## Acceptance criteria' carries 4 '- [ ]' items, not 1 to 3"],
  ],
  [
    "a criterion carrying no check: marker",
    body({ criteria: [criterion("The shape refuses a glob", TEST_CHECK), "- [ ] The door refuses an unregistered part"] }),
    ["criterion 2 carries no check: `<command>` marker: The door refuses an unregistered part"],
  ],
  [
    "a criterion carrying two check: markers",
    body({ criteria: [`${criterion("The shape refuses a glob", GREP_CHECK)} - check: \`${TEST_CHECK}\``] }),
    [
      expect.stringContaining("criterion 1 carries 2 check: markers, not one: The shape refuses a glob"),
      "no check runs tests: a grep or file check may sit beside a test check, never alone",
    ],
  ],
  [
    "a check: marker that does not parse",
    body({ criteria: [`- [ ] The shape refuses a glob - check: ${TEST_CHECK}`] }),
    [
      expect.stringContaining("criterion 1 carries a check: marker that does not parse: The shape refuses a glob"),
      "no check runs tests: a grep or file check may sit beside a test check, never alone",
    ],
  ],
  [
    "a grep check standing alone",
    body({ criteria: [criterion("The shape refuses a glob", GREP_CHECK)] }),
    ["no check runs tests: a grep or file check may sit beside a test check, never alone"],
  ],
  ["a body with no '## Files claimed'", body().replace("## Files claimed", "## Touches"), ["the body carries no '## Files claimed'"]],
  [
    "a glob among the claimed files",
    body({ claimed: ["- src/ticket-shape.ts", "- `core/**/*.test.ts`"] }),
    ["'## Files claimed' names `core/**/*.test.ts`, a glob rather than one file"],
  ],
  ["an em dash in the body", body({ why: `The owner, in session: "file a ticket ${DASH} the machine builds it".` }), ["line 3 carries an em dash"]],
];

describe("src/ticket-shape refuses a ticket body that hides what was meant (#662)", () => {
  it("accepts a well-formed body, and a grep check sitting beside a test check", () => {
    expect(ticketRefusals(body())).toEqual([]);
    expect(
      ticketRefusals(
        body({
          why: "> file a ticket the machine can build\n\nThe session's summary of what that means.",
          criteria: [criterion("The shape refuses each defect", TEST_CHECK), criterion("The refusals reach the caller", GREP_CHECK)],
          claimed: ["- src/ticket-shape.ts", "- `src/post.ts`"],
        }),
      ),
    ).toEqual([]);
  });

  it.each(misshapen)("refuses %s", (_defect, planted, reasons) => {
    expect(ticketRefusals(planted)).toEqual(reasons);
  });

  it("clips the criterion it quotes, so no refusal outgrows a line the caller can print", () => {
    const [refusal] = ticketRefusals(body({ criteria: [`- [ ] ${"a criterion nobody could read ".repeat(8)}`] }));

    expect(refusal.length).toBeLessThanOrEqual(LINE);
    expect(refusal).toMatch(/…$/);
  });

  it("names every defect at once, so one filing does not trickle them out", () => {
    expect(ticketRefusals("nothing shaped like a ticket at all")).toEqual([
      "the body carries no '## Why', so nothing says what the owner asked for",
      "the body carries no '## Acceptance criteria'",
      "the body carries no '## Files claimed'",
    ]);
  });
});

describe("a note asks for a why and nothing else, so a session at its end can file what it found", () => {
  it("accepts a why the owner never spoke, and a body no ticket would carry", () => {
    expect(noteRefusals("## Why\n\nThree passes over 1,009 sessions left four proposals the owner has to weigh.\n")).toEqual([]);
    expect(noteRefusals(`## Why\n\nA finding.\n\n## Anything\n\n${"a line of dumped context\n".repeat(400)}`)).toEqual([]);
  });

  it("refuses a body that says nothing about why it was kept", () => {
    expect(noteRefusals("Four proposals, with no heading over them.")).toEqual([
      "the body carries no '## Why', so nothing says why this was worth keeping",
    ]);
    expect(noteRefusals("## Why\n\n\n## Findings\n\nFour proposals.\n")).toEqual([
      "'## Why' says nothing, so nothing says why this was worth keeping",
    ]);
  });

  it("refuses an em dash, which no filing may carry whatever its kind", () => {
    expect(noteRefusals(`## Why\n\nA finding ${DASH} worth keeping.\n`)).toEqual(["line 3 carries an em dash"]);
  });
});
