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
  "- [ ] The door files a well-formed ticket - check: `npx vitest run --config core/vitest.config.ts post`",
  "",
  "## Files claimed",
  "",
  "- core/post.ts",
  "",
].join("\n");

const registry: Part[] = [
  { name: "core/bin/file-issue", file: "core/bin/file-issue", stops: URL, lines: 5 },
  { name: "core/bin/quiet", file: "core/bin/quiet", stops: URL },
  { name: "core/hooks/loud.mjs", file: "core/hooks/loud.mjs", stops: URL, lines: 4 },
];

function github(result: { status?: number; stdout?: string; stderr?: string } = {}) {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    return { status: result.status ?? 0, stdout: result.stdout ?? `${URL}\n`, stderr: result.stderr ?? "" };
  };
  return { gh, calls };
}

const posting = (fields: Partial<Posting>): Posting => ({ part: "core/bin/file-issue", kind: "ticket", text: TICKET, target: "A ticket", ...fields });

describe("core/post.ts is the one way core/ writes text to GitHub (#662)", () => {
  it("files a well-formed ticket and hands back where it landed", () => {
    const { gh, calls } = github();

    expect(post(posting({}), gh, registry)).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "create", "--title", "A ticket", "--body", TICKET]]);
  });

  it("comments a message that fits its part's registered lines, and refuses one that does not", () => {
    const { gh, calls } = github();
    const message = (part: string, text: string) => post(posting({ part, kind: "message", text, target: "700" }), gh, registry);

    expect(message("core/bin/file-issue", "one line\ntwo\nthree\nfour\nfive")).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["issue", "comment", "700", "--body", "one line\ntwo\nthree\nfour\nfive"]]);
    expect(message("core/bin/file-issue", "one\ntwo\nthree\nfour\nfive\nsix").refusals).toEqual(["core/bin/file-issue said 6 lines, over 5"]);
    expect(message("core/bin/quiet", "one\ntwo").refusals).toEqual(["core/bin/quiet said 2 lines, over 1"]);
    expect(message("core/hooks/loud.mjs", "one\ntwo").refusals).toEqual(["core/hooks/loud.mjs said 2 lines, over 1"]);
    expect(message("core/bin/quiet", "x".repeat(LINE_LIMIT + 1)).refusals).toEqual([`core/bin/quiet said a line of ${LINE_LIMIT + 1} characters, over ${LINE_LIMIT}`]);
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

    expect(post(posting({ part: "core/bin/stranger" }), gh, registry).refusals).toEqual(["core/bin/stranger is not a registered part, so it posts nothing"]);
    expect(post(posting({ kind: "judgement" }), gh, registry).refusals).toEqual(["judgement is not a kind core/post.ts writes: message, ticket"]);
    expect(calls).toEqual([]);
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
