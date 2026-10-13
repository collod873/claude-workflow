import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asFiled, filing, spokenBuild, spokenIdea, spokenMisshapen, wellFormedBug, wellFormedNote, wellFormedSpec } from "./scenarios.ts";
import { BUG_SHAPE, BUILD_SHAPE, IDEA_SHAPE, LOOK_INTO_SHAPE, SPEC_SHAPE, SPOKEN_SHAPE, why } from "./ticket-shape.ts";

const URL = "https://github.com/collod873/claude-workflow/issues/700";
const PAGE = "[sessions](https://github.com/collod873/transcripts/blob/main/issues/claude-workflow-700.md)";
const RECORDS = `python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >>"$PWD/gh-argv"\nprintf '%s\\n' ${URL}\n`;
const REFUSES = "printf 'nothing filed\\n' >&2\nexit 1\n";
const UNSTAMPED = "file-issue: CLAUDE_CODE_SESSION_ID is empty, so the filing names no session\n";
const USAGE = "file-issue: usage: file-issue idea|look-into|build|bug|spec --title <title> --body-file <path>";
const SUGGESTIONS = "## Agent's suggestions";
const filedBuild = asFiled(spokenBuild);
const filedIdea = asFiled(spokenIdea);
const NOTE_CALL = ["idea", "--title", "What the audit found", "--body-file", "body.md"];
const BUG_CALL = ["bug", "--title", "check-gate crashes on a contract with no steps", "--body-file", "body.md"];

const linked = (body: string, before = "") => (before === "" ? `${body.trimEnd()}\n\n${PAGE}\n\n` : body.replace(before, `${PAGE}\n\n${before}`));
const edit = (body: string) => ["issue", "edit", "700", "--body", body];

function ghSaw(repo: string): string[][] {
  if (!existsSync(join(repo, "gh-argv"))) return [];
  return readFileSync(join(repo, "gh-argv"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
}

function bodyOf(call: string[] | undefined, repo: string): string {
  const body = call?.[call.indexOf("--body") + 1];
  if (body === undefined) throw new Error(`no gh call with a --body in ${repo}`);
  return body;
}

const firstBody = (repo: string): string => bodyOf(ghSaw(repo)[0], repo);
const lastBody = (repo: string): string => bodyOf(ghSaw(repo).at(-1), repo);

describe("bin/file-issue files a ticket, or refuses it and files nothing (#662)", () => {
  it("files a well-formed ticket through src/post.ts and says where it landed", () => {
    const { repo, run } = filing({ gh: RECORDS, body: spokenBuild, title: "Port the ticket shape into core/" });

    const result = run();

    expect(result).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: UNSTAMPED });
    expect(ghSaw(repo)).toEqual([["issue", "create", "--title", "Port the ticket shape into core/", "--label", "ticket", "--body", filedBuild], edit(linked(filedBuild, SUGGESTIONS))]);
  });

  it("files a bug labelled ticket and bug, so the machine builds it, and refuses one quoting no evidence as it refuses a ticket quoting no owner", () => {
    const { repo, run } = filing({ gh: RECORDS, body: wellFormedBug });

    expect(run(BUG_CALL)).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: UNSTAMPED });
    expect(ghSaw(repo)).toEqual([
      ["issue", "create", "--title", "check-gate crashes on a contract with no steps", "--label", "ticket", "--label", "bug", "--body", wellFormedBug],
      edit(linked(wellFormedBug, "## Done when")),
    ]);
    expect(filing({ gh: RECORDS, body: wellFormedNote }).run(BUG_CALL)).toMatchObject({
      status: 1,
      stderr: ["'## Why' quotes no evidence: it carries no \"...\" quote and no > quoted line from a log, a test or a Signal", "the body carries no '## Done when', so nothing says what done looks like", ""].join("\n"),
    });
  });

  it("files nothing for a misshapen body and names each defect on its own line", () => {
    const { repo, run } = filing({ gh: RECORDS, body: spokenBuild.replace("## Owner's words", "## Background") });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("the body carries no '## Owner's words'\n");
    expect(ghSaw(repo)).toEqual([]);
  });

  it("refuses a build quoting nobody under the heading its help names, though the filing keeps it as '## Why'", () => {
    const { repo, run } = filing({ gh: RECORDS, body: spokenBuild.replace(/"[^"]+"/, "that a ticket is the only way in") });

    expect(run()).toMatchObject({ status: 1, stdout: "", stderr: "'## Owner's words' quotes no owner words: it carries no \"...\" quote and no > quoted line\n" });
    expect(ghSaw(repo)).toEqual([]);
  });

  it("shows five lines of a body refused more ways than that, and keeps the rest and the count in a log it names", () => {
    const { repo, run } = filing({ gh: RECORDS, body: spokenMisshapen });

    const result = run();

    expect(result.status).toBe(1);
    const said = result.stderr.trim().split("\n");
    expect(said).toHaveLength(5);
    expect(said[4]).toMatch(/^file-issue: \d+ refusals, 4 shown; nothing filed; log \S+\.log$/);
    const log = /log (\S+\.log)$/.exec(said[4] ?? "")?.[1] ?? "";
    const kept = readFileSync(join(repo, log), "utf8").trim().split("\n");
    expect(kept[0]).toMatch(/^\d+ refusals$/);
    expect(kept.length).toBeGreaterThan(5);
    expect(ghSaw(repo)).toEqual([]);
  });

  it("says what gh refused when the filing itself fails", () => {
    const { run } = filing({ gh: REFUSES, body: spokenBuild });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("gh issue create failed: nothing filed\n");
  });

  it("refuses a kind it does not file, the machine's own ticket among them, and a call with no title, without reaching gh", () => {
    const { repo, run } = filing({ gh: RECORDS, body: spokenBuild });

    expect(run(["judgement", "--title", "A judgement", "--body-file", "body.md"])).toMatchObject({
      status: 2,
      stderr: `${USAGE}\n`,
    });
    expect(run(["ticket", "--title", "A ticket", "--body-file", "body.md"])).toMatchObject({ status: 2, stderr: `${USAGE}\n` });
    expect(run(["build", "--body-file", "body.md"]).status).toBe(2);
    expect(ghSaw(repo)).toEqual([]);
  });

  it("files an idea as a note the same body could not file as a build, and labels it so nothing has to read it to know", () => {
    const { repo, run } = filing({ gh: RECORDS, body: spokenIdea });

    expect(run(NOTE_CALL)).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: UNSTAMPED });
    expect(ghSaw(repo)).toEqual([["issue", "create", "--title", "What the audit found", "--label", "note", "--body", filedIdea], edit(linked(filedIdea, SUGGESTIONS))]);
    expect(run().stderr).toContain("the body carries no '## Done when'");
  });

  it("files a look-into as a note labelled research (#902)", () => {
    const { repo, run } = filing({ gh: RECORDS, body: spokenIdea });

    expect(run(["look-into", "--title", "What does the closer judge", "--body-file", "body.md"])).toMatchObject({ status: 0, stdout: `${URL}\n` });
    expect(ghSaw(repo)).toEqual([["issue", "create", "--title", "What does the closer judge", "--label", "note", "--label", "research", "--body", filedIdea], edit(linked(filedIdea, SUGGESTIONS))]);
  });

  it("files a spec through src/post.ts and labels it spec (#965)", () => {
    const { repo, run } = filing({ gh: RECORDS, body: wellFormedSpec });

    const result = run(["spec", "--title", "Give the slicer something to read", "--body-file", "body.md"]);

    expect(result).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: UNSTAMPED });
    expect(ghSaw(repo)).toEqual([
      ["issue", "create", "--title", "Give the slicer something to read", "--label", "spec", "--body", wellFormedSpec],
      edit(linked(wellFormedSpec, "## Solution")),
    ]);
  });

  it("files a spec, stamping the session id under '## Problem Statement' as a ticket's is stamped under '## Why', and links its sessions page beside it", () => {
    const stamped = filing({ gh: RECORDS, body: wellFormedSpec, sessionId: "sess-abc" });

    const result = stamped.run(["spec", "--title", "A spec", "--body-file", "body.md"]);

    expect(result).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: "" });
    const problemStatement = (posted: string) => posted.slice(posted.indexOf("## Problem Statement"), posted.indexOf("## Solution"));
    expect(problemStatement(firstBody(stamped.repo)).trim().split("\n").at(-1)).toBe("Session: `sess-abc`");
    expect(problemStatement(lastBody(stamped.repo)).trim().split("\n").at(-1)).toBe(`Session: \`sess-abc\` · ${PAGE}`);
  });

  it("asks an idea for its three sections by name, the owner's words apart from the agent's", () => {
    const { repo, run } = filing({ gh: RECORDS, body: "Four proposals, with no heading over them.\n" });

    expect(run(NOTE_CALL)).toMatchObject({ status: 1, stderr: "the body carries no '## Owner's words'\nthe body carries no '## Agent's suggestions'\nthe body carries no '## Open'\n" });
    expect(ghSaw(repo)).toEqual([]);
  });

  it("stamps the session id from CLAUDE_CODE_SESSION_ID as the last line of '## Why', links the sessions page beside it once the number is known, and adds nothing once both are there", () => {
    const stamped = filing({ gh: RECORDS, body: spokenBuild, sessionId: "sess-abc" });

    const result = stamped.run();

    expect(result).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: "" });
    expect(why(firstBody(stamped.repo)).split("\n").at(-1)).toBe("Session: `sess-abc`");
    const posted = lastBody(stamped.repo);
    expect(why(posted).split("\n").at(-1)).toBe(`Session: \`sess-abc\` · ${PAGE}`);

    const untouched = filing({ gh: RECORDS, body: posted.replace("## Why", "## Owner's words"), sessionId: "sess-abc" });
    untouched.run();

    expect(ghSaw(untouched.repo)).toHaveLength(1);
    expect(firstBody(untouched.repo)).toBe(posted);
  });

  it("names no session on stderr when CLAUDE_CODE_SESSION_ID is unset or empty, filing the body unchanged either way and linking the sessions page on its own line", () => {
    const unset = filing({ gh: RECORDS, body: spokenBuild });

    const unsetResult = unset.run();

    expect(unsetResult).toMatchObject({ status: 0, stdout: `${URL}\n` });
    expect(unsetResult.stderr).toMatch(/names no session/);
    expect(ghSaw(unset.repo)).toEqual([["issue", "create", "--title", "A ticket the machine can build", "--label", "ticket", "--body", filedBuild], edit(linked(filedBuild, SUGGESTIONS))]);
    expect(why(lastBody(unset.repo)).split("\n").at(-1)).toBe(PAGE);

    const empty = filing({ gh: RECORDS, body: spokenBuild, sessionId: "" });

    const emptyResult = empty.run();

    expect(emptyResult).toMatchObject({ status: 0, stdout: `${URL}\n` });
    expect(emptyResult.stderr).toMatch(/names no session/);
  });

  it("prints its usage line, when each kind is filed and the body it files, to stdout, and exits 0 for help, filing nothing", () => {
    const { repo, run } = filing({ gh: RECORDS, body: spokenBuild });

    const result = run(["--help"]);

    expect(result).toMatchObject({
      status: 0,
      stdout: [USAGE, `idea, look-into, build: ${SPOKEN_SHAPE}`, `idea: ${IDEA_SHAPE}`, `look-into: ${LOOK_INTO_SHAPE}`, `build: ${BUILD_SHAPE}`, `bug: ${BUG_SHAPE}`, `spec: ${SPEC_SHAPE}`, ""].join("\n"),
      stderr: "",
    });
    expect(ghSaw(repo)).toEqual([]);
  });
});
