import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { publishingGh } from "./issue-doors.fixture";
import { publishSpec, specBody, type SpecSource } from "./publish";
import type { SpecAuthorOutput } from "./spec";
import { validateSpecBody } from "./validate-spec";

const SOURCE: SpecSource = { kind: "sheet", issue: 42 };

const draft = (body: string): SpecAuthorOutput => ({
  title: "A thing",
  body,
  openQuestions: [],
  decisions: [],
});

const GOOD =
  "## Problem Statement\nIt is unbuilt.\n\n## Acceptance criteria\n\n" +
  "- [ ] I'll know it works when I can see the thing exist — check: `test -e a-path-this-repo-does-not-have`";

describe("validateSpecBody refuses what the session door has always refused", () => {
  it("a body with no acceptance criteria", () => {
    expect(() => validateSpecBody("## Problem Statement\nIt is unbuilt.")).toThrow(/'- \[ \]' item/);
  });

  it("a body with more than one criterion — three behavioural claims are three specs", () => {
    const body =
      "## Acceptance criteria\n\n- [ ] One — check: `false`\n- [ ] Two — check: `false`";
    expect(() => validateSpecBody(body)).toThrow(/not 2/);
  });

  it("a criterion carrying no runnable check marker", () => {
    const body = "## Acceptance criteria\n\n- [ ] It works well.";
    expect(() => validateSpecBody(body)).toThrow(/well-formed trailing/);
  });

  it("a criterion whose command is already green before any work exists", () => {
    const body = "## Acceptance criteria\n\n- [ ] It already works — check: `true`";
    expect(() => validateSpecBody(body)).toThrow(/already true before any work exists/);
  });

  it("accepts the shape the contract asks for", () => {
    expect(validateSpecBody(GOOD)).toEqual([]);
  });
});

describe("publishSpec's default validator is the real one", () => {
  it("refuses to file a malformed body, and makes no gh call at all", () => {
    const calls: string[][] = [];
    const gh: GhExec = (args) => {
      calls.push(args);
      return "";
    };

    expect(() => publishSpec(gh, draft("## Problem Statement\nIt is unbuilt."), SOURCE)).toThrow(
      /refusing to publish a spec body the validator rejects/,
    );
    expect(calls).toHaveLength(0);
  });

  it("files a well-formed body, source marker and all", () => {
    const { gh, calls } = publishingGh();

    publishSpec(gh, draft(GOOD), SOURCE);

    expect(calls.filter((args) => args[0] === "issue" && args[1] === "create")).toHaveLength(1);
  });

  it("keeps the source marker out of the one criterion — the bug this validator found", () => {
    const trailing = `${GOOD}\n\n<!-- spec-source:v1 {"kind":"sheet","issue":42} -->`;
    expect(() => validateSpecBody(trailing)).toThrow(/doesn't parse/);

    expect(validateSpecBody(specBody(GOOD, SOURCE))).toEqual([]);
  });
});
