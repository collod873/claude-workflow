import { describe, expect, it } from "vitest";
import { countCriteria } from "../shared/ticket-shape";
import { bodyWithCriteria, recordComment, recordText } from "./record.fixture";
import {
  evaluateRecord,
  extractVerdict,
  findMarkerText,
  judge,
  mostRecentRecord,
} from "./record-grammar";

/**
 * What the salvage stage wrote on #55 and this grammar then allowed, verbatim —
 * heading stripped, as `mostRecentRecord` hands a record over. Seven criteria,
 * seven honest failures, and a `No diff.` line that used to outrank all of them.
 */
const DRILL_A_RECORD = `
No diff.

- Drill A ran on a runner: a \`completed\` close carrying no closing record reached the salvage stage, and the gate's verdict on what salvage wrote is recorded here. — UNMET: No salvage record was posted as a comment; no run ID visible.
- A refusal reverses the close end to end — the issue is reopened, the refusal comment names its reason code, and \`close-refused\` is applied. — UNMET: No refusal comment exists; no reopening occurred; no \`close-refused\` label.
- A refusal run exits green; only a degraded outcome is red. — UNMET: No run output visible; no confirmation of exit status.
- Drill B ran: a close carrying a malformed hand-written record is refused without spending a model. — UNMET: No malformed record comment posted; no refusal comment.
- Drill C ran: a close marked \`not planned\` spends no runner — the job-level \`if\` skips it (a run row still appears; its conclusion is \`skipped\`). — UNMET: Issue #59 was closed as \`not_planned\` but no run ID or skip confirmation recorded here.
- Drill D ran: a corrected record posted above a refused one is the one the gate reads, and the close stands. — UNMET: No corrected record posted as comment; no evidence of reopening followed by re-close.
- Every run id from the four drills is recorded on this issue. — UNMET: No run IDs visible in comments or issue body.
`;

describe("findMarkerText", () => {
  it("reads a comment that opens with the heading", () => {
    expect(findMarkerText(recordComment({ instead: "No diff." }))).toContain("No diff.");
  });

  it("refuses a comment that only mentions the heading", () => {
    expect(
      findMarkerText("I think the `## Closing record` grammar is too strict, personally."),
    ).toBeNull();
  });

  it("reads a record typed in a browser, which arrives CRLF", () => {
    const crlf = recordComment().replace(/\n/g, "\r\n");
    expect(findMarkerText(crlf)).not.toBeNull();
    expect(evaluateRecord(findMarkerText(crlf)!, 1).verdict).toBe("allow");
  });

  it("is null for nothing at all", () => {
    expect(findMarkerText(null)).toBeNull();
    expect(findMarkerText(undefined)).toBeNull();
  });
});

describe("mostRecentRecord", () => {
  it("takes the last record, so a corrected one clears a refused one", () => {
    const record = mostRecentRecord([
      { body: recordComment({ bullets: ["A criterion — UNMET: nothing shipped"] }) },
      { body: "the gate refused this, here is a corrected record" },
      { body: recordComment({ bullets: ["A criterion — MET: `src/thing.ts:12`"] }) },
    ]);
    expect(record).toContain("MET: `src/thing.ts:12`");
    expect(record).not.toContain("UNMET");
  });

  it("is null when no comment is a record", () => {
    expect(mostRecentRecord([{ body: "looks good to me" }])).toBeNull();
    expect(mostRecentRecord([])).toBeNull();
    expect(mostRecentRecord(undefined)).toBeNull();
  });
});

describe("extractVerdict", () => {
  it("reads MET from the slot", () => {
    expect(extractVerdict("A criterion — MET: `src/thing.ts:12`")).toBe("MET");
  });

  it("accepts a spaced hyphen as the separator", () => {
    expect(extractVerdict("A criterion - MET: `src/thing.ts:12`")).toBe("MET");
  });

  it("reads NOT MET as UNMET, not as the MET inside it", () => {
    expect(extractVerdict("A criterion — NOT MET: never built")).toBe("UNMET");
  });

  it("ignores a verdict word in the criterion's own wording", () => {
    expect(
      extractVerdict("The UNMET banner renders — MET: `src/banner.tsx:40`"),
    ).toBe("MET");
  });

  it("refuses to pick between two that disagree", () => {
    expect(
      extractVerdict("A criterion — MET: `a/b.ts:1` and also — UNMET: not really"),
    ).toBe("AMBIGUOUS");
  });

  it("is null when the slot is empty", () => {
    expect(extractVerdict("A criterion, definitely met, see the diff")).toBeNull();
  });
});

describe("evaluateRecord", () => {
  it("allows `No diff.` alone when the body declares no criteria to correspond to", () => {
    expect(evaluateRecord(recordText({ instead: "No diff." }), null)).toMatchObject({
      verdict: "allow",
      code: "no-diff",
    });
  });

  // `No diff.` excuses the range and nothing else (ADR-0022). It was the first
  // branch of `evaluateRecord` and returned `allow` before a bullet was read, which
  // is how #55's drill A closed an issue that had delivered none of its seven
  // criteria — run 32916246191, green, `pass (no-diff)`.
  describe("`No diff.` excuses the range and nothing else", () => {
    it("denies a failing criterion declared under `No diff.`", () => {
      const record = recordText({
        noDiff: true,
        bullets: ["First — MET: `src/a.ts:1`", "Second — UNMET: nothing was built"],
      });
      expect(evaluateRecord(record, 2)).toMatchObject({
        verdict: "deny",
        code: "unmet-criterion",
      });
    });

    it("counts bullets against the criteria the same as a ranged record does", () => {
      const record = recordText({ noDiff: true, bullets: ["Only one — MET: `src/a.ts:1`"] });
      expect(evaluateRecord(record, 3)).toMatchObject({
        verdict: "deny",
        code: "criteria-count-mismatch",
      });
    });

    it("still demands shaped evidence on a MET bullet", () => {
      const record = recordText({ noDiff: true, bullets: ["A criterion — MET: it works now"] });
      expect(evaluateRecord(record, 1)).toMatchObject({
        verdict: "deny",
        code: "bad-evidence-shape",
      });
    });

    it("allows a well-shaped record that happens to carry no commit", () => {
      const record = recordText({
        noDiff: true,
        bullets: ["First — MET: `src/a.ts:1`", "Second — MET: `npm test` exit 0"],
      });
      expect(evaluateRecord(record, 2)).toMatchObject({ verdict: "allow", code: "met" });
    });

    it("denies an empty `## Acceptance criteria` heading rather than passing on `No diff.`", () => {
      expect(evaluateRecord(recordText({ instead: "No diff." }), 0)).toMatchObject({
        verdict: "deny",
        code: "missing-acceptance-criteria",
      });
    });

    // The record the salvage stage actually wrote on #55, verbatim, with its heading
    // stripped as `mostRecentRecord` hands it over. The stage was not what failed —
    // it found no evidence and said so seven times — so this fixture is kept exactly
    // as it was written rather than reduced to a minimal case.
    it("denies the record #55's drill A passed", () => {
      expect(evaluateRecord(DRILL_A_RECORD, 7)).toMatchObject({
        verdict: "deny",
        code: "unmet-criterion",
      });
    });
  });

  it("allows a well-shaped record with one bullet per criterion", () => {
    const record = recordText({
      bullets: ["First — MET: `src/a.ts:1`", "Second — MET: `npm test` exit 0"],
    });
    expect(evaluateRecord(record, 2)).toMatchObject({ verdict: "allow", code: "met" });
  });

  it("denies a record with neither a range nor `No diff.`", () => {
    expect(evaluateRecord(recordText({ range: null }), 1)).toMatchObject({
      code: "no-range-or-no-diff",
    });
  });

  it("denies a range written as a bullet, which is how it gets miscounted", () => {
    const record = recordText({
      range: null,
      bullets: ["`main..a1b2c3d`", "A criterion — MET: `src/a.ts:1`"],
    });
    expect(evaluateRecord(record, 2)).toMatchObject({ code: "no-range-or-no-diff" });
  });

  it("accepts a ref as either side of the range, not only a sha", () => {
    expect(evaluateRecord(recordText({ range: "main..HEAD" }), 1).verdict).toBe("allow");
    expect(evaluateRecord(recordText({ range: "main..feat/close-gate" }), 1).verdict).toBe("allow");
  });

  it("denies when the body has no acceptance criteria heading", () => {
    expect(evaluateRecord(recordText(), null)).toMatchObject({
      code: "missing-acceptance-criteria",
    });
  });

  it("denies when the heading exists but holds no checkbox items", () => {
    expect(evaluateRecord(recordText(), 0)).toMatchObject({
      code: "missing-acceptance-criteria",
    });
  });

  it("denies a bullet count that does not match the criterion count", () => {
    expect(evaluateRecord(recordText({ bullets: ["Only one — MET: `a.ts:1`"] }), 3)).toMatchObject({
      code: "criteria-count-mismatch",
    });
  });

  it("denies a bullet with no verdict in the slot", () => {
    expect(evaluateRecord(recordText({ bullets: ["Definitely done, see the diff"] }), 1))
      .toMatchObject({ code: "missing-verdict" });
  });

  it("denies an UNMET criterion", () => {
    expect(evaluateRecord(recordText({ bullets: ["A criterion — UNMET: not built"] }), 1))
      .toMatchObject({ code: "unmet-criterion" });
  });

  it("denies MET with evidence that isn't shaped like evidence", () => {
    expect(evaluateRecord(recordText({ bullets: ["A criterion — MET: I checked"] }), 1))
      .toMatchObject({ code: "bad-evidence-shape" });
  });

  it("denies a bare word:line, which was never a real path", () => {
    expect(evaluateRecord(recordText({ bullets: ["A criterion — MET: foo:12"] }), 1))
      .toMatchObject({ code: "bad-evidence-shape" });
  });

  it("accepts a command with an exit status as evidence", () => {
    expect(evaluateRecord(recordText({ bullets: ["A criterion — MET: `bin/gauntlet` exit 0"] }), 1).verdict)
      .toBe("allow");
  });
});

describe("countCriteria", () => {
  it("counts only checkbox items, never plain bullets", () => {
    const body =
      "## Acceptance criteria\n- [ ] One\n- [x] Two\n- A note, not a criterion\n\n## Files claimed\n- a.ts\n";
    expect(countCriteria(body)).toBe(2);
  });

  it("stops at the next heading", () => {
    expect(countCriteria(bodyWithCriteria(2))).toBe(2);
  });

  it("distinguishes an absent heading from an empty one", () => {
    expect(countCriteria("## What to build\nSomething.\n")).toBeNull();
    expect(countCriteria("## Acceptance criteria\n\n## Files claimed\n- a.ts\n")).toBe(0);
  });

  it("counts a body typed in a browser, which arrives CRLF", () => {
    expect(countCriteria(bodyWithCriteria(2).replace(/\n/g, "\r\n"))).toBe(2);
  });
});

describe("judge", () => {
  it("is null when no record exists, which is not the same as a denial", () => {
    expect(judge(bodyWithCriteria(1), [{ body: "merged" }])).toBeNull();
  });

  it("judges the most recent record against the body's own criterion count", () => {
    expect(
      judge(bodyWithCriteria(2), [
        { body: recordComment({ bullets: ["One — MET: `a.ts:1`", "Two — MET: `b.ts:2`"] }) },
      ]),
    ).toMatchObject({ verdict: "allow" });
  });
});
