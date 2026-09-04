import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { StageExec } from "../shared/stage";
import { createFakeStages } from "../shared/stage.fake";
import { publishingGh } from "./issue-doors.fixture";
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
import { runSpecPublication, type SpecAuthorOutput } from "./spec";
import { NO_VALIDATION } from "./validate-spec.fixture";

const CREATED = 903;

const SHEET_SOURCE: SpecSource = { kind: "sheet", issue: 42 };

const DRAFT: SpecAuthorOutput = {
  title: "A thing",
  body: "## Problem\nIt is unbuilt.",
  openQuestions: [],
  decisions: [],
};

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
    const body = specBody("a quote:\n> like this", SHEET_SOURCE);
    expect(body.split("-->")).toHaveLength(2);
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
    const { gh, calls } = publishingGh();

    expect(publishSpec(gh, DRAFT, SHEET_SOURCE, NO_VALIDATION)).toBe(CREATED);

    const creates = calls.filter((args) => args[0] === "issue" && args[1] === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual(expect.arrayContaining(["--label", PRD_LABEL]));
    expect(creates[0]).toEqual(expect.arrayContaining(["--title", "PRD: A thing"]));
  });

  it("labels on the create itself, never as a follow-up edit", () => {
    const { gh, calls } = publishingGh();

    publishSpec(gh, DRAFT, SHEET_SOURCE, NO_VALIDATION);

    expect(calls.filter((args) => args[0] === "issue" && args[1] === "edit")).toHaveLength(0);
  });

  it("records the source on the published body", () => {
    const { gh, calls } = publishingGh();

    publishSpec(gh, DRAFT, SHEET_SOURCE, NO_VALIDATION);

    const body = calls[0][calls[0].indexOf("--body") + 1];
    expect(readSourceMarker(body)).toEqual(SHEET_SOURCE);
  });

  it("throws rather than returning NaN when the create prints no issue URL", () => {
    const gh: GhExec = () => "something went wrong";
    expect(() => publishSpec(gh, DRAFT, SHEET_SOURCE, NO_VALIDATION)).toThrow(/could not parse an issue number/);
  });
});

describe("updateSpec", () => {
  it("edits the existing issue rather than filing a second one", () => {
    const { gh, calls } = publishingGh();

    updateSpec(gh, 901, DRAFT, SHEET_SOURCE);

    expect(calls.filter((args) => args[0] === "issue" && args[1] === "create")).toHaveLength(0);
    expect(calls[0].slice(0, 3)).toEqual(["issue", "edit", "901"]);
  });

  it("re-appends the source, so a re-run never loses the spec's provenance", () => {
    const { gh, calls } = publishingGh();

    updateSpec(gh, 901, DRAFT, SHEET_SOURCE);

    expect(readSourceMarker(calls[0][calls[0].indexOf("--body") + 1])).toEqual(SHEET_SOURCE);
  });
});

describe("runSpecPublication: ADR-0062's publish-then-gate order", () => {
  const SWEEP_RESPONSE = JSON.stringify({ rulings: [] });

  const chain = (openQuestions: string[]) =>
    createFakeStages([
      SWEEP_RESPONSE,
      JSON.stringify({ title: "A thing", body: "## Problem\nIt is unbuilt.", openQuestions }),
      JSON.stringify({ resolutions: [] }),
    ]);

  const BARE_CONTEXT = {
    ownerWords: "build it",
    decisions: "",
    rulings: "",
    boundaries: "",
    openGuesses: "",
  };

  const publishFromSheet = (stage: { exec: StageExec }, gh: GhExec) =>
    runSpecPublication(stage.exec, gh, SHEET_SOURCE, BARE_CONTEXT, NO_VALIDATION);

  it("publishes, then applies sliceable and dispatches, when nothing was left open", async () => {
    const { gh, calls } = publishingGh();
    const stage = chain([]);

    const result = await publishFromSheet(stage, gh);

    expect(result).toMatchObject({ issueNumber: CREATED, gateCount: 0, outcome: "dispatched" });

    const createIndex = calls.findIndex((args) => args[0] === "issue" && args[1] === "create");
    const dispatchIndex = calls.findIndex(
      (args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches",
    );
    expect(createIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(createIndex);
    expect(calls[dispatchIndex]).toContain(`event_type=${SPEC_DISPATCH_EVENT_TYPE}`);
  });

  it("publishes and dispatches even when the author leaves a question unresolved (#263, no more held spec)", async () => {
    const { gh, calls } = publishingGh();
    const stage = chain(["What does done mean?"]);

    const result = await publishFromSheet(stage, gh);

    expect(result).toMatchObject({ issueNumber: CREATED, gateCount: 1, outcome: "dispatched" });
    expect(calls.filter((args) => args[0] === "issue" && args[1] === "create")).toHaveLength(1);

    const labelWrites = calls.filter((args) => args.includes(SLICEABLE_LABEL));
    expect(labelWrites).toHaveLength(1);

    const comments = calls.filter((args) => args[0] === "issue" && args[1] === "comment");
    expect(comments).toHaveLength(0);
  });
});
