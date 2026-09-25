import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filing, misshapenTicket, wellFormedNote, wellFormedTicket } from "./scenarios.ts";
import { why } from "./ticket-shape.ts";

const URL = "https://github.com/collod873/claude-workflow/issues/700";
const RECORDS = `python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >>"$PWD/gh-argv"\nprintf '%s\\n' ${URL}\n`;
const REFUSES = "printf 'nothing filed\\n' >&2\nexit 1\n";
const RAN_A_CHECK = "printf 'a note never pays for a check run\\n' >&2\nexit 1\n";
const NOTE_CALL = ["note", "--title", "What the audit found", "--body-file", "body.md"];

function ghSaw(repo: string): string[][] {
  if (!existsSync(join(repo, "gh-argv"))) return [];
  return readFileSync(join(repo, "gh-argv"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
}

function bodyOf(call: string[]): string {
  return call[call.indexOf("--body") + 1];
}

describe("bin/file-issue files a ticket, or refuses it and files nothing (#662)", () => {
  it("files a well-formed ticket through src/post.ts and says where it landed", () => {
    const { repo, run } = filing({ gh: RECORDS, body: wellFormedTicket, title: "Port the ticket shape into core/" });

    const result = run();

    expect(result).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: "" });
    expect(ghSaw(repo)).toEqual([["issue", "create", "--title", "Port the ticket shape into core/", "--body", wellFormedTicket]]);
  });

  it("files nothing for a misshapen body and names each defect on its own line", () => {
    const { repo, run } = filing({ gh: RECORDS, body: wellFormedTicket.replace("## Why", "## Background") });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("the body carries no '## Why', so nothing says what the owner asked for\n");
    expect(ghSaw(repo)).toEqual([]);
  });

  it("shows five lines of a body refused more ways than that, and keeps the rest and the count in a log it names", () => {
    const { repo, run } = filing({ gh: RECORDS, body: misshapenTicket });

    const result = run();

    expect(result.status).toBe(1);
    const said = result.stderr.trim().split("\n");
    expect(said).toHaveLength(5);
    expect(said[4]).toMatch(/^file-issue: \d+ refusals, 4 shown; nothing filed; log \S+\.log$/);
    const log = /log (\S+\.log)$/.exec(said[4])?.[1] ?? "";
    const kept = readFileSync(join(repo, log), "utf8").trim().split("\n");
    expect(kept[0]).toMatch(/^\d+ refusals$/);
    expect(kept.length).toBeGreaterThan(5);
    expect(ghSaw(repo)).toEqual([]);
  });

  it("says what gh refused when the filing itself fails", () => {
    const { run } = filing({ gh: REFUSES, body: wellFormedTicket });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("gh issue create failed: nothing filed\n");
  });

  it("refuses a kind it does not file and a call with no title, without reaching gh", () => {
    const { repo, run } = filing({ gh: RECORDS, body: wellFormedTicket });

    expect(run(["judgement", "--title", "A judgement", "--body-file", "body.md"])).toMatchObject({
      status: 2,
      stderr: "file-issue: usage: file-issue ticket|note --title <title> --body-file <path>\n",
    });
    expect(run(["ticket", "--body-file", "body.md"]).status).toBe(2);
    expect(ghSaw(repo)).toEqual([]);
  });

  it("files a note the same body could not file as a ticket, and labels it so nothing has to read it to know", () => {
    const { repo, run } = filing({ gh: RECORDS, body: wellFormedNote, npx: RAN_A_CHECK });

    expect(run(NOTE_CALL)).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: "" });
    expect(ghSaw(repo)).toEqual([["issue", "create", "--title", "What the audit found", "--label", "note", "--body", wellFormedNote]]);
    expect(run().stderr).toContain("the body carries no '## Acceptance criteria'");
  });

  it("asks a note for a why and nothing else, so filing one at the end of a session costs no judgement", () => {
    const { repo, run } = filing({ gh: RECORDS, body: "Four proposals, with no heading over them.\n" });

    expect(run(NOTE_CALL)).toMatchObject({ status: 1, stderr: "the body carries no '## Why', so nothing says why this was worth keeping\n" });
    expect(ghSaw(repo)).toEqual([]);
  });

  it("stamps the session id from CLAUDE_CODE_SESSION_ID as the last line of '## Why', and adds nothing once it is already there", () => {
    const stamped = filing({ gh: RECORDS, body: wellFormedTicket, sessionId: "sess-abc" });

    const result = stamped.run();

    expect(result).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: "" });
    const posted = bodyOf(ghSaw(stamped.repo)[0]);
    expect(why(posted).split("\n").at(-1)).toBe("Session: `sess-abc`");

    const untouched = filing({ gh: RECORDS, body: posted, sessionId: "sess-abc" });
    untouched.run();

    expect(bodyOf(ghSaw(untouched.repo)[0])).toBe(posted);
  });

  it("names no session on stderr when CLAUDE_CODE_SESSION_ID is unset or empty, filing the body unchanged either way", () => {
    const unset = filing({ gh: RECORDS, body: wellFormedTicket });

    const unsetResult = unset.run();

    expect(unsetResult).toMatchObject({ status: 0, stdout: `${URL}\n` });
    expect(unsetResult.stderr).toMatch(/names no session/);
    expect(ghSaw(unset.repo)).toEqual([["issue", "create", "--title", "A ticket the machine can build", "--body", wellFormedTicket]]);

    const empty = filing({ gh: RECORDS, body: wellFormedTicket, sessionId: "" });

    const emptyResult = empty.run();

    expect(emptyResult).toMatchObject({ status: 0, stdout: `${URL}\n` });
    expect(emptyResult.stderr).toMatch(/names no session/);
  });

  it("prints its usage line to stdout and exits 0 for help, filing nothing", () => {
    const { repo, run } = filing({ gh: RECORDS, body: wellFormedTicket });

    const result = run(["--help"]);

    expect(result).toMatchObject({
      status: 0,
      stdout: "file-issue: usage: file-issue ticket|note --title <title> --body-file <path>\n",
      stderr: "",
    });
    expect(ghSaw(repo)).toEqual([]);
  });
});
