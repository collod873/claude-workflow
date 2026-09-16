import { describe, expect, it } from "vitest";
import { test } from "vitest";
import { sheetMarker } from "../shared/marker";
import { checkProbation, countSilentSheets, SILENT_SHEET_THRESHOLD } from "./probation";
import type { Sheet } from "../shared/sheet-schema";
import type { GhExec } from "../shared/gh";
import { trackerMemory } from "../shared/tracker-memory";
import type { TrackerSignal } from "../shared/tracker";

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

function openSignal(number: number, body: string | null = null): TrackerSignal {
  return { number, body, state: "OPEN", stateReason: null };
}

function silentSheetsTracker(n: number) {
  const numbers = Array.from({ length: n }, (_, index) => index + 1);
  return trackerMemory({
    signals: numbers.map((number) => openSignal(number)),
    issues: Object.fromEntries(numbers.map((number) => [number, { comments: [sheetComment([])] }])),
  });
}

describe("counting silent sheets", () => {
  it("counts a sheet the refuter had nothing to say about", () => {
    expect(countSilentSheets(silentSheetsTracker(3))).toBe(3);
  });

  it("does not count a sheet that carried a survivor", () => {
    const tracker = trackerMemory({
      signals: [openSignal(1)],
      issues: { 1: { comments: [sheetComment(["decision 2 contradicts ADR-0010"])] } },
    });

    expect(countSilentSheets(tracker)).toBe(0);
  });

  it("counts every sheet on an issue, not every issue", () => {
    const tracker = trackerMemory({
      signals: [openSignal(1)],
      issues: { 1: { comments: [sheetComment([]), sheetComment([]), sheetComment(["a"])] } },
    });

    expect(countSilentSheets(tracker)).toBe(2);
  });
});

interface ProbationSeed {
  silent?: Map<number, string[]>;
  priorProposalBodies?: string[];
}

function probationGh(seed: ProbationSeed = {}): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const silent = seed.silent ?? new Map<number, string[]>();
  const priorProposalBodies = seed.priorProposalBodies ?? [];

  const gh: GhExec = (args) => {
    calls.push([...args]);
    const [command, sub] = args;

    if (command === "issue" && sub === "list") {
      const silentSignals = [...silent.keys()].map((number) => openSignal(number));
      const proposalSignals = priorProposalBodies.map((body, index) => ({
        number: 9000 + index,
        body,
        state: "CLOSED",
        stateReason: "COMPLETED",
      }));
      return JSON.stringify([...silentSignals, ...proposalSignals]);
    }

    if (command === "issue" && sub === "view") {
      const number = Number(args[2]);
      return JSON.stringify({ comments: (silent.get(number) ?? []).map((body) => ({ body })) });
    }

    return "";
  };

  return { gh, calls };
}

function silentSheetsGh(n: number, priorProposalBodies: string[] = []): { gh: GhExec; calls: string[][] } {
  const numbers = Array.from({ length: n }, (_, index) => index + 1);
  return probationGh({
    silent: new Map(numbers.map((number) => [number, [sheetComment([])]])),
    priorProposalBodies,
  });
}

const PRIOR_PROPOSAL_AT_THRESHOLD = [`<!-- refuter-probation:v1 silent=${SILENT_SHEET_THRESHOLD} -->`];

describe("the probation", () => {
  it("says where it is, below the threshold, and files nothing", () => {
    const { gh, calls } = silentSheetsGh(3);

    expect(checkProbation(gh, gh)).toContain(`3/${SILENT_SHEET_THRESHOLD}`);
    expect(calls.some((call) => call[0] === "issue" && call[1] === "create")).toBe(false);
  });

  it("files a proposal at the threshold, proposing deletion and never performing it", () => {
    const { gh, calls } = silentSheetsGh(SILENT_SHEET_THRESHOLD);

    checkProbation(gh, gh);

    const created = calls.find((call) => call[0] === "issue" && call[1] === "create")!;
    expect(created).toBeDefined();
    expect(created[created.indexOf("--title") + 1]).toContain(String(SILENT_SHEET_THRESHOLD));
    expect(created[created.indexOf("--body") + 1]).toContain("Nothing is deleted by this issue");
  });

  it("does not re-propose at the same count, reading the prior proposal even though it is closed", () => {
    const { gh, calls } = silentSheetsGh(SILENT_SHEET_THRESHOLD, PRIOR_PROPOSAL_AT_THRESHOLD);

    expect(checkProbation(gh, gh)).toContain("already proposed");
    expect(calls.some((call) => call[1] === "create")).toBe(false);
  });

  it("re-proposes once the count has grown", () => {
    const { gh } = silentSheetsGh(SILENT_SHEET_THRESHOLD + 1, PRIOR_PROPOSAL_AT_THRESHOLD);

    expect(checkProbation(gh, gh)).toContain("filed a deletion proposal");
  });
});

test("#619.2: countSilentSheets counts sheets via the Tracker handed to it (trackerMemory's signals() and issueComments()), not by re-deriving one from a raw GhExec search argv", () => {
  const tracker = trackerMemory({
    signals: [1, 2, 3].map((number) => ({ number, body: null, state: "OPEN", stateReason: null })),
    issues: {
      1: { comments: [sheetComment([])] },
      2: { comments: [sheetComment([])] },
      3: { comments: [sheetComment(["a"])] },
    },
  });

  expect(countSilentSheets(tracker as unknown as GhExec)).toBe(2);
});
