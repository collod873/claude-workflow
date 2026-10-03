import { describe, expect, expectTypeOf, it } from "vitest";
import { labelsOf, NEEDS_HUMAN, post, RESEARCH, RESOLVING, WAITING, type Posting } from "./post.ts";
import { wellFormedNote as NOTE, wellFormedSpec as SPEC } from "./scenarios.ts";

const URL = "https://github.com/collod873/claude-workflow/issues/700";
const TICKET = [
  "## Why",
  "",
  'The owner, in session: "the machine takes a ticket and nothing else".',
  "",
  "## Done when",
  "",
  "- The door files a well-formed ticket.",
  "",
].join("\n");

function github(result: { status?: number; stdout?: string; stderr?: string } = {}) {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    return { status: result.status ?? 0, stdout: result.stdout ?? `${URL}\n`, stderr: result.stderr ?? "" };
  };
  return { gh, calls };
}

const posting = (fields: Partial<Posting>): Posting => ({ kind: "ticket", text: TICKET, title: "A ticket", ...fields });

describe("src/post.ts is the one way the machine writes text to GitHub (#662)", () => {
  it("files a well-formed ticket labelled ticket, so the owner can filter the issue list by them (#1056)", () => {
    const { gh, calls } = github();

    expect(post(posting({}), gh)).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "A ticket", "--label", "ticket", "--body", TICKET]]);
  });

  it("files a follow-up labelled ticket beside waiting (#1056)", () => {
    const { gh, calls } = github();

    expect(post(posting({ labels: ["waiting"] }), gh)).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "A ticket", "--label", "ticket", "--body", TICKET, "--label", "waiting"]]);
  });

  it("judges a ticket by the ticket shape rather than by the message limit", () => {
    const { gh, calls } = github();

    expect(post(posting({}), gh).refusals).toEqual([]);
    expect(post(posting({ text: TICKET.replace("## Why", "## Background") }), gh).refusals).toEqual([
      "the body carries no '## Why', so nothing says what the owner asked for",
    ]);
    expect(post(posting({ title: undefined }), gh).refusals).toEqual(["a ticket carries no title"]);
    expect(calls).toHaveLength(1);
  });

  it("refuses a kind the table does not carry", () => {
    const { gh, calls } = github();

    expect(post(posting({ kind: "memo" }), gh).refusals).toEqual(["memo is not a kind src/post.ts writes: ticket, note, research, spec, judgement"]);
    expect(calls).toEqual([]);
  });

  it("files a spec labelled spec, refusing it by the spec shape rather than the ticket shape", () => {
    const { gh, calls } = github();
    const spec = (fields: Partial<Posting>) => post(posting({ kind: "spec", text: SPEC, title: "A spec the slicer can read", ...fields }), gh);

    expect(spec({})).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "A spec the slicer can read", "--label", "spec", "--body", SPEC]]);
    expect(spec({ title: undefined }).refusals).toEqual(["a spec carries no title"]);
    expect(spec({ text: SPEC.replace("## Problem Statement", "## Background") }).refusals).toEqual([
      "the body carries no '## Problem Statement', so nothing says what the owner asked for",
    ]);
    expect(calls).toHaveLength(1);
  });

  it("labels a note, so the stub that starts a build from issues: opened can tell it from a ticket", () => {
    const { gh, calls } = github();
    const note = (fields: Partial<Posting>) => post(posting({ kind: "note", text: NOTE, title: "What the audit found", ...fields }), gh);

    expect(note({})).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "What the audit found", "--label", "note", "--body", NOTE]]);
    expect(note({ title: undefined }).refusals).toEqual(["a note carries no title"]);
    expect(note({ text: "Four proposals, with no heading over them." }).refusals).toEqual([
      "the body carries no '## Why', so nothing says why this was worth keeping",
    ]);
    expect(calls).toHaveLength(1);
  });

  it("labels a research note both note and research, so no build starts and the research workflow does (#902)", () => {
    const { gh, calls } = github();

    expect(post(posting({ kind: "research", text: NOTE, title: "What does the closer judge" }), gh)).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "What does the closer judge", "--label", "note", "--label", "research", "--body", NOTE]]);
    expect(post(posting({ kind: "research", text: "What does the closer judge?" }), gh).refusals).toEqual([
      "the body carries no '## Why', so nothing says why this was worth keeping",
    ]);
  });

  it("asks a note for none of what it asks a ticket, so filing one costs no judgement", () => {
    const { gh } = github();

    expect(post(posting({ kind: "note", text: NOTE, title: "What the audit found" }), gh).refusals).toEqual([]);
    expect(post(posting({ text: NOTE }), gh).refusals).toEqual([
      "'## Why' quotes no owner words: it carries no \"...\" quote and no > quoted line",
      "the body carries no '## Done when', so nothing says what done looks like",
    ]);
  });

  it("posts a judgement on the PR it judged, and refuses one with no PR or an em dash", () => {
    const { gh, calls } = github();
    const text = "The reviewer found drift.\n\n- the Why asks for more than was built\n";
    const judgement = (fields: Partial<Posting>) => post(posting({ kind: "judgement", text, title: undefined, pr: "901", ...fields }), gh);

    expect(judgement({})).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["pr", "comment", "901", "--body", text]]);
    expect(judgement({ pr: undefined }).refusals).toEqual(["a judgement carries no pr"]);
    expect(judgement({ text: `${text}- one gap ${String.fromCodePoint(0x2014)} dashed\n` }).refusals).toEqual(["line 4 carries an em dash"]);
    expect(calls).toHaveLength(1);
  });

  it("hands back what gh said when the write itself fails", () => {
    const { gh } = github({ status: 1, stdout: "", stderr: "GraphQL: Resource not accessible by integration\nsecond line\n" });

    expect(post(posting({}), gh).refusals).toEqual(["gh issue create failed: GraphQL: Resource not accessible by integration"]);
  });
});

describe("src/post.ts reads an issue's labels for the closer and the builder alike, beside the mark helper (#1073)", () => {
  it("names each label the issue holds", () => {
    const { gh, calls } = github({ stdout: "ticket\nlanding\n" });

    expect(labelsOf("873", gh)).toEqual(["ticket", "landing"]);
    expect(calls).toEqual([["issue", "view", "873", "--json", "labels", "--jq", ".labels[].name"]]);
  });

  it("gives the unread stop, never an empty list, when the issue cannot be read (#1099)", () => {
    const { gh } = github({ status: 1, stdout: "", stderr: "GraphQL: Could not resolve to an issue" });

    expect(labelsOf("874", gh)).toBe("unread");
  });
});

describe("the label constants keep their own names (#1103)", () => {
  it("types each one as exactly its label, so one set to another label fails typecheck", () => {
    expectTypeOf(NEEDS_HUMAN).toEqualTypeOf<"needs-human">();
    expectTypeOf(WAITING).toEqualTypeOf<"waiting">();
    expectTypeOf(RESOLVING).toEqualTypeOf<"resolving">();
    expectTypeOf(RESEARCH).toEqualTypeOf<"research">();
  });
});
