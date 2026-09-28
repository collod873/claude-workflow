import { describe, expect, it } from "vitest";
import { LINE_LIMIT } from "./scenarios.ts";
import { noteRefusals, specRefusals, ticketRefusals } from "./ticket-shape.ts";

const DASH = "\u2014";
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
  [
    "a glob among the files to read",
    `${body()}\n## Files to read\n\n- src/*.ts\n`,
    ["'## Files to read' names `src/*.ts`, a glob rather than one file"],
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
    if (refusal === undefined) throw new Error("no refusal for a long criterion");

    expect(refusal.length).toBeLessThanOrEqual(LINE_LIMIT);
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

const SPEC_QUOTE = 'The owner, in session: "a spec is filed once, so the cold read and the slicer share one document".';

function specBody({
  problem = SPEC_QUOTE,
  solution = "File a spec kind alongside a ticket, sharing its filing pipeline.",
  stories = ["1. As the owner, I can file a spec before any ticket exists."],
  implementation = "Reuse the ticket machinery where it already fits.",
  testing = "Cover the shape with unit tests.",
  outOfScope = "The cold read and the slicer.",
  furtherNotes = "",
  sharedNames,
  sentences = [`- [ ] see a spec land as its own issue - check: \`${TEST_CHECK}\``],
}: {
  problem?: string;
  solution?: string;
  stories?: string[];
  implementation?: string;
  testing?: string;
  outOfScope?: string;
  furtherNotes?: string;
  sharedNames?: string;
  sentences?: string[];
} = {}): string {
  const lines = [
    "## Problem Statement",
    "",
    problem,
    "",
    "## Solution",
    "",
    solution,
    "",
    "## User Stories",
    "",
    ...stories,
    "",
    "## Implementation Decisions",
    "",
    implementation,
    "",
    "## Testing Decisions",
    "",
    testing,
    "",
    "## Out of Scope",
    "",
    outOfScope,
    "",
    "## Further Notes",
    "",
  ];
  if (furtherNotes !== "") lines.push(furtherNotes, "");
  if (sharedNames !== undefined) lines.push("## Shared names", "", sharedNames, "");
  lines.push("## I'll know it works when I can", "", ...sentences, "");
  return lines.join("\n");
}

const misshapenSpec: [string, string, unknown[]][] = [
  [
    "a spec with none of its headings",
    "nothing shaped like a spec at all",
    [
      "the body carries no '## Problem Statement', so nothing says what the owner asked for",
      "the body carries no '## Solution'",
      "the body carries no '## User Stories'",
      "the body carries no '## Implementation Decisions'",
      "the body carries no '## Testing Decisions'",
      "the body carries no '## Out of Scope'",
      "the body carries no '## Further Notes'",
      "the body carries no '## I'll know it works when I can'",
    ],
  ],
  [
    "a spec whose '## Problem Statement' quotes no owner words",
    specBody({ problem: "The session decided this was worth spec'ing." }),
    ["'## Problem Statement' quotes no owner words: it carries no \"...\" quote and no > quoted line"],
  ],
  ["a spec whose '## Solution' says nothing", specBody({ solution: "" }), ["'## Solution' says nothing"]],
  [
    "a spec whose '## User Stories' names no numbered item",
    specBody({ stories: ["As the owner, I can file a spec."] }),
    ["'## User Stories' carries no numbered item"],
  ],
  [
    "a spec naming a file path in '## Implementation Decisions'",
    specBody({ implementation: "Change `src/post.ts` to add the kind." }),
    ["'## Implementation Decisions' names `src/post.ts`, a file path"],
  ],
  [
    "a spec with a heading after \"## I'll know it works when I can\"",
    `${specBody()}## Extra\n\nsomething after the sentences\n`,
    ["a heading follows '## I'll know it works when I can', which must be last"],
  ],
  [
    "a spec with no sentence under \"## I'll know it works when I can\"",
    specBody({ sentences: [] }),
    ["'## I'll know it works when I can' carries no '- [ ]' item, so the done check has nothing to try"],
  ],
  [
    "a spec whose sentence carries a check: marker that does not parse",
    specBody({ sentences: ["- [ ] see a spec land - check: npx vitest run"] }),
    [expect.stringContaining("sentence 1 carries a check: marker that does not parse: see a spec land")],
  ],
  [
    "a spec with an em dash",
    specBody({ solution: `File a spec kind ${DASH} sharing the ticket pipeline.` }),
    ["line 7 carries an em dash"],
  ],
];

describe("src/ticket-shape refuses a spec body that hides what the owner meant (#965)", () => {
  it("accepts a well-formed spec, with or without an optional '## Shared names'", () => {
    expect(specRefusals(specBody())).toEqual([]);
    expect(specRefusals(specBody({ sharedNames: "`Ticket` refers to any filed issue." }))).toEqual([]);
  });

  it.each(misshapenSpec)("refuses %s", (_defect, planted, reasons) => {
    expect(specRefusals(planted)).toEqual(reasons);
  });
});
