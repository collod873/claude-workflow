import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { StageExec } from "../shared/stage";
import type { FakeStage } from "../shared/stage.fake";
import { SLICEABLE_LABEL, SPEC_DISPATCH_EVENT_TYPE } from "./open-questions";
import {
  PRD_LABEL,
  publishSpec,
  readSourceMarker,
  sourceMarker,
  specBody,
  specTitle,
  updateSpec,
  type SpecSource,
} from "./publish";
import { planSpecRun, runSpecPublication } from "./spec";

/**
 * A fake `GhExec` that answers a create with a URL and records everything else, so a test can
 * assert on the whole write sequence lane 02 makes — the create, the label, the dispatch, the
 * comment — in the order it made them.
 */
function fakeGh(options: { issueNumber?: number; specBody?: string } = {}): {
  gh: GhExec;
  calls: string[][];
} {
  const issueNumber = options.issueNumber ?? 900;
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    if (args[0] === "issue" && args[1] === "create") {
      return `https://github.com/owner/repo/issues/${issueNumber}\n`;
    }
    if (args[0] === "issue" && args[1] === "view") {
      return options.specBody ?? "";
    }
    return "";
  };
  return { gh, calls };
}

const SHEET_SOURCE: SpecSource = { kind: "sheet", issue: 42 };

const DRAFT = { title: "A thing", body: "## Problem\nIt is unbuilt.", openQuestions: [] as string[] };

describe("specTitle", () => {
  it("prefixes a title the author did not prefix", () => {
    expect(specTitle("A thing")).toBe("PRD: A thing");
  });

  it("does not prefix one that is already prefixed", () => {
    expect(specTitle("PRD: A thing")).toBe("PRD: A thing");
  });

  it("recognises the prefix whatever its case, so a run never publishes PRD: PRD:", () => {
    expect(specTitle("prd: A thing")).toBe("prd: A thing");
  });
});

describe("the spec-source marker", () => {
  it("round-trips a source through a body", () => {
    expect(readSourceMarker(specBody("prose", SHEET_SOURCE))).toEqual(SHEET_SOURCE);
  });

  it("survives a body whose prose contains a > character", () => {
    // `shape/marker.ts`'s escaping, for the reason its header gives: an unescaped `-->` inside the
    // JSON would close the HTML comment early and strand everything after it.
    const body = specBody("a quote:\n> like this", SHEET_SOURCE);
    expect(body).not.toContain("-->\n");
    expect(readSourceMarker(body)).toEqual(SHEET_SOURCE);
  });

  it("reads a body carrying no marker as no source, rather than throwing", () => {
    expect(readSourceMarker("just prose")).toBeUndefined();
  });

  it("reads an unreadable marker as no source, so a rotted trailer does not strand the spec", () => {
    expect(readSourceMarker(`prose\n\n<!-- spec-source:v1 {not json -->`)).toBeUndefined();
  });

  it("reads a well-formed marker carrying the wrong shape as no source", () => {
    expect(readSourceMarker(`prose\n\n${'<!-- spec-source:v1 {"kind":"invented"} -->'}`)).toBeUndefined();
  });
});

describe("publishSpec", () => {
  it("files one prd-labelled issue and answers its number", () => {
    const { gh, calls } = fakeGh({ issueNumber: 901 });

    expect(publishSpec(gh, DRAFT, SHEET_SOURCE)).toBe(901);

    const creates = calls.filter((args) => args[0] === "issue" && args[1] === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual(expect.arrayContaining(["--label", PRD_LABEL]));
    expect(creates[0]).toEqual(expect.arrayContaining(["--title", "PRD: A thing"]));
  });

  it("labels on the create itself, never as a follow-up edit", () => {
    // A spec that exists for a moment without `prd` is one `/triage` and `release-on-prd-close.yml`
    // both read as an ordinary issue, and this lane cannot notice it lost that race.
    const { gh, calls } = fakeGh();

    publishSpec(gh, DRAFT, SHEET_SOURCE);

    expect(calls.filter((args) => args[0] === "issue" && args[1] === "edit")).toHaveLength(0);
  });

  it("records the source on the published body", () => {
    const { gh, calls } = fakeGh();

    publishSpec(gh, DRAFT, SHEET_SOURCE);

    const body = calls[0][calls[0].indexOf("--body") + 1];
    expect(readSourceMarker(body)).toEqual(SHEET_SOURCE);
  });

  it("throws rather than returning NaN when the create prints no issue URL", () => {
    const gh: GhExec = () => "something went wrong";
    expect(() => publishSpec(gh, DRAFT, SHEET_SOURCE)).toThrow(/could not parse an issue number/);
  });
});

describe("updateSpec", () => {
  it("edits the existing issue rather than filing a second one", () => {
    const { gh, calls } = fakeGh();

    updateSpec(gh, 901, DRAFT, SHEET_SOURCE);

    expect(calls.filter((args) => args[0] === "issue" && args[1] === "create")).toHaveLength(0);
    expect(calls[0].slice(0, 3)).toEqual(["issue", "edit", "901"]);
  });

  it("re-appends the source, so a re-run never loses the spec's provenance", () => {
    const { gh, calls } = fakeGh();

    updateSpec(gh, 901, DRAFT, SHEET_SOURCE);

    expect(readSourceMarker(calls[0][calls[0].indexOf("--body") + 1])).toEqual(SHEET_SOURCE);
  });
});

describe("planSpecRun", () => {
  it("sends a sheet trigger to the sheet collector and publishes a new spec", () => {
    const { gh } = fakeGh();

    const { input, target } = planSpecRun(gh, { trigger: "sheet", issueNumber: 42 });

    expect(input).toMatchObject({ kind: "sheet", issueNumber: 42 });
    expect(target).toEqual({ mode: "publish", source: { kind: "sheet", issue: 42 } });
  });

  it("sends a map trigger to the map collector and publishes a new spec", () => {
    const { gh } = fakeGh();

    const { input, target } = planSpecRun(gh, { trigger: "map", issueNumber: 76 });

    expect(input).toMatchObject({ kind: "map", issueNumber: 76 });
    expect(target).toEqual({ mode: "publish", source: { kind: "map", issue: 76 } });
  });

  it("re-runs an answer against the spec's recorded source, and rewrites the spec in place", () => {
    // The point of the marker: a comment event knows the spec's number, and every collector reads
    // the *source* the spec was drafted from.
    const { gh } = fakeGh({ specBody: specBody("the spec", SHEET_SOURCE) });

    const { input, target } = planSpecRun(gh, { trigger: "answer", issueNumber: 901 });

    expect(input).toMatchObject({ kind: "sheet", issueNumber: 42 });
    expect(target).toEqual({ mode: "rerun", issueNumber: 901, source: SHEET_SOURCE });
  });

  it("refuses an answer on a spec recording no source, rather than guessing at one", () => {
    const { gh } = fakeGh({ specBody: "a spec with no trailer" });

    expect(() => planSpecRun(gh, { trigger: "answer", issueNumber: 901 })).toThrow(
      /records no readable spec-source marker/,
    );
  });
});

describe("runSpecPublication — ADR-0062's publish-then-gate order", () => {
  /**
   * Two stages run in this chain and they answer different schemas — the author's
   * `{title, body, openQuestions}`, then the critic's `{findings}` — so the shared one-response
   * fake cannot drive it. This answers each call in turn instead.
   */
  function chainStage(responses: string[]): FakeStage {
    const calls: string[][] = [];
    const stdins: Array<string | undefined> = [];
    let next = 0;
    return {
      calls,
      stdins,
      exec: (async (argv: string[], stdin?: string) => {
        calls.push(argv);
        stdins.push(stdin);
        const response = responses[next++];
        if (response === undefined) {
          throw new Error(`fake stage: no canned response for call ${next}`);
        }
        return response;
      }) as StageExec,
    };
  }

  const chain = (openQuestions: string[], findings: string[] = []) =>
    chainStage([
      JSON.stringify({ title: "A thing", body: "## Problem\nIt is unbuilt.", openQuestions }),
      JSON.stringify({ findings }),
    ]);

  it("publishes, then applies sliceable and dispatches, when nothing was left open", async () => {
    const { gh, calls } = fakeGh({ issueNumber: 901 });
    // Both stages in the chain — the author and the critic — read the same canned answer; the
    // critic's `findings` are absent from it, which folds to no extra questions.
    const stage = chain([]);

    const result = await runSpecPublication(
      stage.exec,
      gh,
      { mode: "publish", source: SHEET_SOURCE },
      { ownerWords: "build it", decisions: "", rulings: "", boundaries: "", openGuesses: "" },
    );

    expect(result).toMatchObject({ issueNumber: 901, published: true, gateCount: 0, outcome: "dispatched" });

    const createIndex = calls.findIndex((args) => args[0] === "issue" && args[1] === "create");
    const dispatchIndex = calls.findIndex(
      (args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches",
    );
    expect(createIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(createIndex);
    expect(calls[dispatchIndex]).toContain(`event_type=${SPEC_DISPATCH_EVENT_TYPE}`);
  });

  it("publishes anyway when questions are open, so a held spec is visible", async () => {
    // ADR-0062: "a spec that never reaches zero never slices — that is the correct behaviour and
    // it is visible: the issue sits carrying `prd` without `sliceable`." A gate that decided
    // whether to publish would hide the one outcome meant to reach the owner.
    const { gh, calls } = fakeGh({ issueNumber: 902 });
    const stage = chain(["What does done mean?"]);

    const result = await runSpecPublication(
      stage.exec,
      gh,
      { mode: "publish", source: SHEET_SOURCE },
      { ownerWords: "build it", decisions: "", rulings: "", boundaries: "", openGuesses: "" },
    );

    expect(result).toMatchObject({ issueNumber: 902, gateCount: 1, outcome: "held" });
    expect(calls.filter((args) => args[0] === "issue" && args[1] === "create")).toHaveLength(1);

    const labelWrites = calls.filter((args) => args.includes(SLICEABLE_LABEL));
    expect(labelWrites).toHaveLength(0);

    const comments = calls.filter((args) => args[0] === "issue" && args[1] === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0].join(" ")).toContain("1. What does done mean?");
  });

  it("rewrites rather than re-files on a re-run", async () => {
    const { gh, calls } = fakeGh();
    const stage = chain([]);

    const result = await runSpecPublication(
      stage.exec,
      gh,
      { mode: "rerun", issueNumber: 901, source: SHEET_SOURCE },
      { ownerWords: "build it", decisions: "", rulings: "", boundaries: "", openGuesses: "" },
    );

    expect(result).toMatchObject({ issueNumber: 901, published: false, outcome: "dispatched" });
    expect(calls.filter((args) => args[0] === "issue" && args[1] === "create")).toHaveLength(0);
    expect(calls.some((args) => args[0] === "issue" && args[1] === "edit" && args[2] === "901")).toBe(true);
  });
});
