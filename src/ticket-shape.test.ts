import { describe, expect, it } from "vitest";
import { handedOn as builderBrief } from "./builder.ts";
import { handedOn as reviewerBrief } from "./reviewer.ts";
import { DONE_SENTENCES, NOTE_SHAPE, SPEC_SHAPE, TICKET_SHAPE, noteRefusals, specRefusals, ticketRefusals } from "./ticket-shape.ts";

const DASH = "\u2014";
const TEST_CHECK = "npx vitest run --config vitest.config.ts ticket-shape";
const QUOTED = 'The owner, in session: "file a ticket the machine can build".';

function body({ why = QUOTED, done = ["- Filing a body with no why files nothing."] }: { why?: string; done?: string[] } = {}): string {
  return ["## Why", "", why, "", "## Done when", "", ...done, ""].join("\n");
}

const misshapen: [string, string, string[]][] = [
  ["a body with no '## Why'", body().replace("## Why", "## Background"), ["the body carries no '## Why', so nothing says what the owner asked for"]],
  [
    "a '## Why' quoting no owner words",
    body({ why: "The session decided this would be worth building." }),
    ["'## Why' quotes no owner words: it carries no \"...\" quote and no > quoted line"],
  ],
  ["a body with no '## Done when'", body().replace("## Done when", "## Plan"), ["the body carries no '## Done when', so nothing says what done looks like"]],
  ["a '## Done when' with no sentence under it", body({ done: ["Filing refuses a bad body."] }), ["'## Done when' carries 0 '- ' sentences, not 1 to 3"]],
  ["four sentences", body({ done: [1, 2, 3, 4].map((n) => `- Filing refuses defect ${n}.`) }), ["'## Done when' carries 4 '- ' sentences, not 1 to 3"]],
  ["an em dash in the body", body({ why: `The owner, in session: "file a ticket ${DASH} the machine builds it".` }), ["line 3 carries an em dash"]],
];

describe("src/ticket-shape refuses a ticket body that hides what was meant (#662, #931)", () => {
  it("accepts a Why in the owner's words and 1 to 3 plain sentences, checked or not, with any other heading after them", () => {
    expect(ticketRefusals(body())).toEqual([]);
    expect(
      ticketRefusals(
        `${body({
          why: "> file a ticket the machine can build\n\nThe session's summary of what that means.",
          done: ["- [ ] Filing refuses each defect.", "- The refusals reach the caller,", "  one to a line."],
        })}\n## Out of scope\n\n- Specs.\n- Notes.\n- Research.\n- Anything else.\n`,
      ),
    ).toEqual([]);
  });

  it.each(misshapen)("refuses %s", (_defect, planted, reasons) => {
    expect(ticketRefusals(planted)).toEqual(reasons);
  });

  it("names every defect at once, so one filing does not trickle them out", () => {
    expect(ticketRefusals("nothing shaped like a ticket at all")).toEqual([
      "the body carries no '## Why', so nothing says what the owner asked for",
      "the body carries no '## Done when', so nothing says what done looks like",
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

describe("the shape bin/file-issue --help prints names every heading its kind is refused without", () => {
  const HEADING_NAMED = /'## (.+?)'(?=[,\s]|$)/g;

  it.each([
    ["ticket", TICKET_SHAPE, ticketRefusals],
    ["note", NOTE_SHAPE, noteRefusals],
    ["spec", SPEC_SHAPE, specRefusals],
  ])("%s", (_, shape, refusals) => {
    const named = refusals("").flatMap((refusal) => [...refusal.matchAll(HEADING_NAMED)].map(([, name]) => name ?? ""));

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !shape.includes(`## ${name}`))).toEqual([]);
  });
});

describe("the builder's split, the reviewer's follow-ups and bin/file-issue --help read one Done when phrase, not hand copies (#1004)", () => {
  it.each([
    ["bin/file-issue --help", TICKET_SHAPE],
    ["the builder's split", builderBrief({ ticket: "1", body: body() })],
    ["the reviewer's follow-ups", reviewerBrief(body(), "", { earlier: "", fix: "" })],
  ])("%s", (_, text) => {
    expect(text).toContain(DONE_SENTENCES);
    expect(text.replace(DONE_SENTENCES, "")).not.toMatch(/\d+ to \d+/);
  });
});
