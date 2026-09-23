import { describe, expect, it } from "vitest";
import { post, type Posting } from "./post.ts";

const URL = "https://github.com/collod873/claude-workflow/issues/700";
const TICKET = [
  "## Why",
  "",
  'The owner, in session: "the machine takes a ticket and nothing else".',
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The door files a well-formed ticket - check: `npx vitest run --config vitest.config.ts post`",
  "",
  "## Files claimed",
  "",
  "- src/post.ts",
  "",
].join("\n");

const NOTE = ["## Why", "", "Three passes over the standards left four proposals nobody can build until the owner weighs them.", ""].join("\n");

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
  it("files a well-formed ticket and hands back where it landed", () => {
    const { gh, calls } = github();

    expect(post(posting({}), gh)).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "A ticket", "--body", TICKET]]);
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

    expect(post(posting({ kind: "spec" }), gh).refusals).toEqual(["spec is not a kind src/post.ts writes: ticket, note, judgement"]);
    expect(calls).toEqual([]);
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

  it("asks a note for none of what it asks a ticket, so filing one costs no judgement", () => {
    const { gh } = github();

    expect(post(posting({ kind: "note", text: NOTE, title: "What the audit found" }), gh).refusals).toEqual([]);
    expect(post(posting({ text: NOTE }), gh).refusals).toEqual([
      "'## Why' quotes no owner words: it carries no \"...\" quote and no > quoted line",
      "the body carries no '## Acceptance criteria'",
      "the body carries no '## Files claimed'",
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
