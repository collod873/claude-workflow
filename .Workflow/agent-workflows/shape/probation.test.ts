import { describe, expect, it } from "vitest";
import { sheetMarker } from "./marker";
import { checkProbation, countSilentSheets, SILENT_SHEET_THRESHOLD } from "./probation";
import type { Sheet } from "./sheet-schema";
import { createFakeTracker } from "./tracker.fake";

/**
 * §6's backwards question, discharged for lane 01: *everything that claims to
 * catch something is asked whether it ever did.* ADR-0031 converts the
 * refuter's probation from an event nobody scheduled into a count that fires
 * on its own, and the whole ruling rests on two behaviours — it **files an
 * issue and never deletes the stage**, and a declined proposal **re-proposes
 * only when the count has grown.**
 */

function sheetComment(survivors: string[]): string {
  const sheet: Sheet = {
    restatement: "r",
    priorArt: [],
    decisions: [],
    survivors,
    route: "short",
    routeReason: "…",
    newTerms: [],
    round: 0,
  };
  return `## Restatement\n\nr\n\n${sheetMarker(sheet)}`;
}

/** `n` issues, each carrying one sheet, all of them silent. */
function silentSheets(n: number) {
  const numbers = Array.from({ length: n }, (_, index) => index + 1);
  return createFakeTracker({
    searchResults: numbers,
    comments: new Map(numbers.map((number) => [number, [sheetComment([])]])),
  });
}

describe("counting silent sheets", () => {
  it("counts a sheet the refuter had nothing to say about", () => {
    expect(countSilentSheets(silentSheets(3).gh)).toBe(3);
  });

  it("does not count a sheet that carried a survivor", () => {
    const tracker = createFakeTracker({
      searchResults: [1],
      comments: new Map([[1, [sheetComment(["decision 2 contradicts ADR-0010"])]]]),
    });

    expect(countSilentSheets(tracker.gh)).toBe(0);
  });

  it("counts every sheet on an issue, not every issue", () => {
    // A re-run posts a new comment rather than editing (§01), so one issue
    // carries up to three sheets and each one is a separate spend of the
    // refuter.
    const tracker = createFakeTracker({
      searchResults: [1],
      comments: new Map([[1, [sheetComment([]), sheetComment([]), sheetComment(["a"])]]]),
    });

    expect(countSilentSheets(tracker.gh)).toBe(2);
  });

  it("scopes its search to this repo", () => {
    // `gh search issues` searches the whole of GitHub without `--repo`. A
    // search that quietly went estate-wide would count another repo's sheets
    // toward this repo's probation.
    const tracker = silentSheets(1);
    countSilentSheets(tracker.gh);

    const search = tracker.calls.find((call) => call[0] === "search")!;
    expect(search).toContain("--repo");
    expect(search).toContain("collod873/claude-workflow");
  });
});

describe("the probation", () => {
  it("says where it is, below the threshold, and files nothing", () => {
    const tracker = silentSheets(3);

    expect(checkProbation(tracker.gh)).toContain(`3/${SILENT_SHEET_THRESHOLD}`);
    expect(tracker.calls.some((call) => call[0] === "issue" && call[1] === "create")).toBe(false);
  });

  it("files a proposal at the threshold", () => {
    const tracker = silentSheets(SILENT_SHEET_THRESHOLD);

    checkProbation(tracker.gh);

    const created = tracker.calls.find((call) => call[0] === "issue" && call[1] === "create")!;
    expect(created).toBeDefined();
    expect(created[created.indexOf("--title") + 1]).toContain(String(SILENT_SHEET_THRESHOLD));
  });

  it("proposes deletion and never performs it", () => {
    // §6: every lens and counter produces issues and never notifications —
    // the refuter's death arrives as work the owner rules on, not as an
    // automatic amputation.
    const tracker = silentSheets(SILENT_SHEET_THRESHOLD);

    checkProbation(tracker.gh);

    const created = tracker.calls.find((call) => call[0] === "issue" && call[1] === "create")!;
    const body = created[created.indexOf("--body") + 1];
    expect(body).toContain("Nothing is deleted by this issue");
  });

  it("does not re-propose at the same count", () => {
    const tracker = silentSheets(SILENT_SHEET_THRESHOLD);
    tracker.bodySearchResults = [`<!-- refuter-probation:v1 silent=${SILENT_SHEET_THRESHOLD} -->`];

    expect(checkProbation(tracker.gh)).toContain("already proposed");
    expect(tracker.calls.some((call) => call[1] === "create")).toBe(false);
  });

  it("re-proposes once the count has grown", () => {
    // ADR-0019's two-site gate, inherited: a declined finding re-proposes only
    // when its recurrence grew, so the counter cannot nag.
    const tracker = silentSheets(SILENT_SHEET_THRESHOLD + 1);
    tracker.bodySearchResults = [`<!-- refuter-probation:v1 silent=${SILENT_SHEET_THRESHOLD} -->`];

    expect(checkProbation(tracker.gh)).toContain("filed a deletion proposal");
  });

  it("reads closed proposals too — a declined one is exactly what must not re-file", () => {
    // Asserted as the *absence* of `--state`, which is the only way to ask for
    // both: `gh search issues --state` takes `open|closed` and nothing else,
    // and its default spans them. A `--state all` here would not narrow the
    // search, it would fail the call — and a probation check that errors on
    // its re-propose guard would re-file at the same count forever.
    const tracker = silentSheets(SILENT_SHEET_THRESHOLD);
    tracker.bodySearchResults = [`<!-- refuter-probation:v1 silent=${SILENT_SHEET_THRESHOLD} -->`];

    checkProbation(tracker.gh);

    const search = tracker.calls.filter((call) => call[0] === "search").at(-1)!;
    expect(search).toContain("body");
    expect(search).not.toContain("--state");
  });
});
