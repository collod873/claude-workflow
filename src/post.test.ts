import { describe, expect, it } from "vitest";
import { authoredOn, commentOnPr, labelsHeld, opened, post, readOrStop, type Posting } from "./post.ts";
import { filedAs, wellFormedNote as NOTE, wellFormedSpec as SPEC } from "./scenarios.ts";

const URL = "https://github.com/collod873/claude-workflow/issues/700";
const PAGE = "[sessions](https://github.com/collod873/transcripts/blob/main/issues/claude-workflow-700.md)";
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
const BUG = [
  "## Why",
  "",
  "The Signals of session 7a2c read:",
  "",
  "> hookkit: check-gate crashed 3 times: TypeError: Cannot read properties of undefined",
  "",
  "## Done when",
  "",
  "- check-gate reads a contract with no steps and says so.",
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

const linked = (body: string, before = "") => (before === "" ? `${body.trimEnd()}\n\n${PAGE}\n\n` : body.replace(before, `${PAGE}\n\n${before}`));
const edit = (body: string) => ["issue", "edit", "700", "--body", body];

const posting = (fields: Partial<Posting>): Posting => ({ kind: "ticket", text: TICKET, title: "A ticket", ...fields });

describe("src/post.ts is the one way the machine writes text to GitHub (#662)", () => {
  it("files a well-formed ticket labelled ticket, so the owner can filter the issue list by them (#1056)", () => {
    const { gh, calls } = github();

    expect(post(posting({}), gh)).toEqual({ refusals: [], said: URL });
    expect(filedAs(calls)).toEqual({ title: "A ticket", labels: ["ticket"], body: TICKET, then: [edit(linked(TICKET, "## Done when"))] });
  });

  it("files a follow-up labelled ticket beside waiting (#1056)", () => {
    const { gh, calls } = github();

    expect(post(posting({ labels: ["waiting"] }), gh)).toEqual({ refusals: [], said: URL });
    expect(filedAs(calls)).toEqual({ title: "A ticket", labels: ["ticket", "waiting"], body: TICKET, then: [edit(linked(TICKET, "## Done when"))] });
  });

  it("judges a ticket by the ticket shape rather than by the message limit", () => {
    const { gh, calls } = github();

    expect(post(posting({}), gh).refusals).toEqual([]);
    expect(post(posting({ text: TICKET.replace("## Why", "## Background") }), gh).refusals).toEqual([
      "the body carries no '## Why', so nothing says what the owner asked for",
    ]);
    expect(post(posting({ title: undefined }), gh).refusals).toEqual(["a ticket carries no title"]);
    expect(calls).toHaveLength(2);
  });

  it("refuses a kind the table does not carry", () => {
    const { gh, calls } = github();

    const { refusals } = post(posting({ kind: "memo" }), gh);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/^memo is not a kind src\/post\.ts writes: .*\bticket\b/);
    expect(calls).toEqual([]);
  });

  it("files a bug labelled ticket and bug, so the machine builds it like a ticket and the label says a log, test or Signal proved it, not the owner", () => {
    const { gh, calls } = github();
    const bug = (fields: Partial<Posting>) => post(posting({ kind: "bug", text: BUG, title: "check-gate crashes on a contract with no steps", ...fields }), gh);

    expect(bug({})).toEqual({ refusals: [], said: URL });
    expect(filedAs(calls)).toEqual({ title: "check-gate crashes on a contract with no steps", labels: ["ticket", "bug"], body: BUG, then: [edit(linked(BUG, "## Done when"))] });
    expect(bug({ title: undefined }).refusals).toEqual(["a bug carries no title"]);
    expect(bug({ text: BUG.replace("> ", "") }).refusals).toEqual(['\'## Why\' quotes no evidence: it carries no "..." quote and no > quoted line from a log, a test or a Signal']);
    expect(bug({ text: BUG.replace("## Why", "## Background") }).refusals).toEqual(["the body carries no '## Why', so nothing shows the fault"]);
    expect(calls).toHaveLength(2);
  });

  it("files a spec labelled spec, refusing it by the spec shape rather than the ticket shape", () => {
    const { gh, calls } = github();
    const spec = (fields: Partial<Posting>) => post(posting({ kind: "spec", text: SPEC, title: "A spec the slicer can read", ...fields }), gh);

    expect(spec({})).toEqual({ refusals: [], said: URL });
    expect(filedAs(calls)).toEqual({ title: "A spec the slicer can read", labels: ["spec"], body: SPEC, then: [edit(linked(SPEC, "## Solution"))] });
    expect(spec({ title: undefined }).refusals).toEqual(["a spec carries no title"]);
    expect(spec({ text: SPEC.replace("## Problem Statement", "## Background") }).refusals).toEqual([
      "the body carries no '## Problem Statement', so nothing says what the owner asked for",
    ]);
    expect(calls).toHaveLength(2);
  });

  it("labels a note, so the stub that starts a build from issues: opened can tell it from a ticket", () => {
    const { gh, calls } = github();
    const note = (fields: Partial<Posting>) => post(posting({ kind: "note", text: NOTE, title: "What the audit found", ...fields }), gh);

    expect(note({})).toEqual({ refusals: [], said: URL });
    expect(filedAs(calls)).toEqual({ title: "What the audit found", labels: ["note"], body: NOTE, then: [edit(linked(NOTE))] });
    expect(note({ title: undefined }).refusals).toEqual(["a note carries no title"]);
    expect(note({ text: "Four proposals, with no heading over them." }).refusals).toEqual([
      "the body carries no '## Why', so nothing says why this was worth keeping",
    ]);
    expect(calls).toHaveLength(2);
  });

  it("labels a research note both note and research, so no build starts and the research workflow does (#902)", () => {
    const { gh, calls } = github();

    expect(post(posting({ kind: "research", text: NOTE, title: "What does the closer judge" }), gh)).toEqual({ refusals: [], said: URL });
    expect(filedAs(calls)).toEqual({ title: "What does the closer judge", labels: ["note", "research"], body: NOTE, then: [edit(linked(NOTE))] });
    expect(post(posting({ kind: "research", text: "What does the closer judge?" }), gh).refusals).toEqual([
      "the body carries no '## Why', so nothing says why this was worth keeping",
    ]);
  });

  it("comments on a PR with each em dash taken out, as a filing is", () => {
    const { gh, calls } = github();
    const dash = String.fromCodePoint(0x2014);

    expect(commentOnPr("901", `The reviewer found drift ${dash} the Why asks for more than was built.\n`, gh)).toEqual({ refusals: [], said: URL });
    expect(calls).toEqual([["pr", "comment", "901", "--body", "The reviewer found drift, the Why asks for more than was built.\n"]]);
  });

  it("files with each em dash taken out rather than refusing, since a cold filing to PW-Rosters was lost to one on 2026-10-12", () => {
    const { gh, calls } = github();
    const dash = String.fromCodePoint(0x2014);

    expect(post(posting({ title: `A ticket ${dash} dashed`, text: TICKET.replace("takes a ticket and", `takes a ticket ${dash} and builds it ${dash} and`).replace("well-formed ticket.", `well-formed ticket, 1${dash}3 sentences.`) }), gh)).toEqual({ refusals: [], said: URL });
    expect(calls[0]?.[3]).toBe("A ticket, dashed");
    expect(calls[0]?.at(-1)).toBe(TICKET.replace("takes a ticket and", "takes a ticket, and builds it, and").replace("well-formed ticket.", "well-formed ticket, 1-3 sentences."));
  });

  it("creates the labels a repo lacks and files again, since five of eleven refused filings were a label not found", () => {
    const calls: string[][] = [];
    let refused = false;
    const gh = (args: string[]) => {
      calls.push(args);
      if (args[1] === "create" && !refused) {
        refused = true;
        return { status: 1, stdout: "", stderr: "could not add label: 'note' not found\n" };
      }
      return { status: 0, stdout: `${URL}\n`, stderr: "" };
    };

    expect(post(posting({ kind: "research", text: NOTE, title: "Look into it" }), gh)).toEqual({ refusals: [], said: URL });
    expect(calls.map((args) => args.slice(0, 3))).toEqual([
      ["issue", "create", "--title"],
      ["label", "create", "note"],
      ["label", "create", "research"],
      ["issue", "create", "--title"],
      ["issue", "edit", "700"],
    ]);
  });

  it("hands back what gh said when the write itself fails", () => {
    const { gh } = github({ status: 1, stdout: "", stderr: "GraphQL: Resource not accessible by integration\nsecond line\n" });

    expect(post(posting({}), gh).refusals).toEqual(["gh issue create failed: GraphQL: Resource not accessible by integration"]);
  });
});

describe("every filing links the transcripts page listing the sessions that filed, built or touched it, with one edit once its number is known", () => {
  it("puts the link beside the session id on the Session line, and on its own line when no session is named", () => {
    const stamped = github();
    const unstamped = github();

    expect(post(posting({ sessionId: "sess-abc" }), stamped.gh)).toEqual({ refusals: [], said: URL });
    expect(post(posting({}), unstamped.gh)).toEqual({ refusals: [], said: URL });
    expect(stamped.calls.map((args) => args.at(-1))).toEqual([TICKET.replace("## Done when", "Session: `sess-abc`\n\n## Done when"), TICKET.replace("## Done when", `Session: \`sess-abc\` · ${PAGE}\n\n## Done when`)]);
    expect(unstamped.calls.map((args) => args.at(-1))).toEqual([TICKET, linked(TICKET, "## Done when")]);
  });

  it("names the page after the repo gh filed in, lower-cased as the transcripts repo names it, and the issue's number", () => {
    const { gh, calls } = github({ stdout: "https://github.com/collod873/Lumaria/issues/12\n" });

    expect(post(posting({}), gh)).toEqual({ refusals: [], said: "https://github.com/collod873/Lumaria/issues/12" });
    expect(calls[1]).toEqual(["issue", "edit", "12", "--body", TICKET.replace("## Done when", "[sessions](https://github.com/collod873/transcripts/blob/main/issues/lumaria-12.md)\n\n## Done when")]);
  });

  it("edits nothing when the body already carries the link, and links nothing when gh prints no issue URL", () => {
    const carried = github();
    const unnumbered = github({ stdout: "filed\n" });

    expect(post(posting({ text: linked(TICKET, "## Done when"), sessionId: "sess-abc" }), carried.gh)).toEqual({ refusals: [], said: URL });
    expect(post(posting({}), unnumbered.gh)).toEqual({ refusals: [], said: "filed" });
    expect(carried.calls).toHaveLength(1);
    expect(unnumbered.calls).toHaveLength(1);
  });

  it("answers the URL of a filing whose link edit fails, naming it unlinked on stderr, so a caller never files it again", () => {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return args[1] === "edit" ? { status: 1, stdout: "", stderr: "GraphQL: Resource not accessible by integration\n" } : { status: 0, stdout: `${URL}\n`, stderr: "" };
    };

    const said: string[] = [];
    const error = console.error;
    console.error = (text: string) => said.push(text);
    try {
      expect(post(posting({}), gh)).toEqual({ refusals: [], said: URL });
    } finally {
      console.error = error;
    }
    expect(said).toEqual([`${URL} was filed, but gh issue edit failed: GraphQL: Resource not accessible by integration, so it carries no sessions link`]);
    expect(calls).toHaveLength(2);
  });
});

describe("src/post.ts reads what GitHub holds, stopping at unread itself, so no caller converts a stand-in (#1073, #1123)", () => {
  const failing = github({ status: 1, stdout: "", stderr: "gh: Server Error (HTTP 502)" }).gh;

  it("names each label the issue holds", () => {
    const { gh, calls } = github({ stdout: "ticket\nlanding\n" });

    expect(labelsHeld("873", gh)).toEqual(new Set(["ticket", "landing"]));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("873");
  });

  it.each([
    { read: "the labels", run: (): unknown => labelsHeld("874", failing), line: "read: the labels of #874 could not be read, so nothing is marked" },
    { read: "the comments", run: () => authoredOn("874", "the comments on #874 could not be read", failing), line: "read: the comments on #874 could not be read" },
    { read: "the issue", run: () => opened("874", "#874 could not be read", failing), line: "read: #874 could not be read" },
  ])("stops at unread naming the read when GitHub fails $read (#1099)", ({ run, line }) => {
    const said: string[] = [];
    const error = console.error;
    console.error = (text: string) => said.push(text);
    try {
      expect(readOrStop("read", run)).toBe("unread");
    } finally {
      console.error = error;
    }
    expect(said).toEqual([line]);
  });

  it("answers missing, never unread, when the issue is not there", () => {
    const { gh } = github({ status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" });

    expect(opened("874/parent", "the parent of #874 could not be read", gh)).toBe("missing");
  });
});
