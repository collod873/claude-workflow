import { describe, expect, it } from "vitest";
import { sheetMarker } from "../shared/marker";
import { checkProbation, countSilentSheets, SILENT_SHEET_THRESHOLD } from "./probation";
import type { Sheet } from "../shared/sheet-schema";
import { createFakeTracker } from "./tracker.fake";

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
    const tracker = createFakeTracker({
      searchResults: [1],
      comments: new Map([[1, [sheetComment([]), sheetComment([]), sheetComment(["a"])]]]),
    });

    expect(countSilentSheets(tracker.gh)).toBe(2);
  });

  it("scopes its search to this repo", () => {
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
    const tracker = silentSheets(SILENT_SHEET_THRESHOLD + 1);
    tracker.bodySearchResults = [`<!-- refuter-probation:v1 silent=${SILENT_SHEET_THRESHOLD} -->`];

    expect(checkProbation(tracker.gh)).toContain("filed a deletion proposal");
  });

  it("reads closed proposals too — a declined one is exactly what must not re-file", () => {
    const tracker = silentSheets(SILENT_SHEET_THRESHOLD);
    tracker.bodySearchResults = [`<!-- refuter-probation:v1 silent=${SILENT_SHEET_THRESHOLD} -->`];

    checkProbation(tracker.gh);

    const search = tracker.calls.filter((call) => call[0] === "search").at(-1)!;
    expect(search).toContain("body");
    expect(search).not.toContain("--state");
  });
});
