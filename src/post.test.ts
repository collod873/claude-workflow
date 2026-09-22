import { describe, expect, it } from "vitest";
import type { Part } from "./parts.ts";
import { LINE_LIMIT, MOST_LINES, linesAllowed, overLimit, post, type Posting } from "./post.ts";

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

const registry: Part[] = [
  { name: "bin/file-issue", file: "bin/file-issue", stops: URL, lines: 5 },
  { name: "bin/quiet", file: "bin/quiet", stops: URL },
  { name: "src/hooks/loud.mjs", file: "src/hooks/loud.mjs", stops: URL, lines: 4 },
];

function github(result: { status?: number; stdout?: string; stderr?: string } = {}) {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    return { status: result.status ?? 0, stdout: result.stdout ?? `${URL}\n`, stderr: result.stderr ?? "" };
  };
  return { gh, calls };
}

const posting = (fields: Partial<Posting>): Posting => ({ part: "bin/file-issue", kind: "ticket", text: TICKET, target: "A ticket", ...fields });

describe("src/post.ts is the one way the machine writes text to GitHub (#662)", () => {
  it("files a well-formed ticket and hands back where it landed", () => {
    const { gh, calls } = github();

    expect(post(posting({}), gh, registry)).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "A ticket", "--body", TICKET]]);
  });

  it("comments a message that fits its part's registered lines, and refuses one that does not", () => {
    const { gh, calls } = github();
    const message = (part: string, text: string) => post(posting({ part, kind: "message", text, target: "700" }), gh, registry);

    expect(message("bin/file-issue", "one line\ntwo\nthree\nfour\nfive")).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "comment", "700", "--body", "one line\ntwo\nthree\nfour\nfive"]]);
    expect(message("bin/file-issue", "one\ntwo\nthree\nfour\nfive\nsix").refusals).toEqual(["bin/file-issue said 6 lines, over 5"]);
    expect(message("bin/quiet", "one\ntwo").refusals).toEqual(["bin/quiet said 2 lines, over 1"]);
    expect(message("src/hooks/loud.mjs", "one\ntwo").refusals).toEqual(["src/hooks/loud.mjs said 2 lines, over 1"]);
    expect(message("bin/quiet", "x".repeat(LINE_LIMIT + 1)).refusals).toEqual([`bin/quiet said a line of ${LINE_LIMIT + 1} characters, over ${LINE_LIMIT}`]);
    expect(calls).toHaveLength(1);
  });

  it("judges a ticket by the ticket shape rather than by the message limit", () => {
    const { gh, calls } = github();

    expect(post(posting({}), gh, registry).refusals).toEqual([]);
    expect(post(posting({ text: TICKET.replace("## Why", "## Background") }), gh, registry).refusals).toEqual([
      "the body carries no '## Why', so nothing says what the owner asked for",
    ]);
    expect(post(posting({ target: undefined }), gh, registry).refusals).toEqual(["a ticket carries no title"]);
    expect(calls).toHaveLength(1);
  });

  it("refuses a part nobody registered and a kind the table does not carry", () => {
    const { gh, calls } = github();

    expect(post(posting({ part: "bin/stranger" }), gh, registry).refusals).toEqual(["bin/stranger is not a registered part, so it posts nothing"]);
    expect(post(posting({ kind: "judgement" }), gh, registry).refusals).toEqual(["judgement is not a kind src/post.ts writes: message, ticket, note"]);
    expect(calls).toEqual([]);
  });

  it("labels a note, so the stub that starts a build from issues: opened can tell it from a ticket", () => {
    const { gh, calls } = github();
    const note = (fields: Partial<Posting>) => post(posting({ kind: "note", text: NOTE, target: "What the audit found", ...fields }), gh, registry);

    expect(note({})).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "What the audit found", "--label", "note", "--body", NOTE]]);
    expect(note({ target: undefined }).refusals).toEqual(["a note carries no title"]);
    expect(note({ text: "Four proposals, with no heading over them." }).refusals).toEqual([
      "the body carries no '## Why', so nothing says why this was worth keeping",
    ]);
    expect(calls).toHaveLength(1);
  });

  it("asks a note for none of what it asks a ticket, so filing one costs no judgement", () => {
    const { gh } = github();

    expect(post(posting({ kind: "note", text: NOTE, target: "What the audit found" }), gh, registry).refusals).toEqual([]);
    expect(post(posting({ text: NOTE }), gh, registry).refusals).toEqual([
      "'## Why' quotes no owner words: it carries no \"...\" quote and no > quoted line",
      "the body carries no '## Acceptance criteria'",
      "the body carries no '## Files claimed'",
    ]);
  });

  it("hands back what gh said when the write itself fails", () => {
    const { gh } = github({ status: 1, stdout: "", stderr: "GraphQL: Resource not accessible by integration\nsecond line\n" });

    expect(post(posting({}), gh, registry).refusals).toEqual(["gh issue create failed: GraphQL: Resource not accessible by integration"]);
  });

  it("reads the lines a part may say from its registration, and a hook's as one", () => {
    expect(registry.map(linesAllowed)).toEqual([MOST_LINES, 1, 1]);
    expect(overLimit("one\ntwo\n", 2)).toEqual([]);
    expect(overLimit(`${"x".repeat(LINE_LIMIT + 2)}\ntwo`, 1)).toEqual([
      `said a line of ${LINE_LIMIT + 2} characters, over ${LINE_LIMIT}`,
      "said 2 lines, over 1",
    ]);
  });
});
