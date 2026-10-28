import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILDER_SESSION, CHECK_PASSES, CHECK_RED, FULL_CHECK_RED_ONCE, fixing, SPENT_BY_THE_THIRD_ROUND } from "./builder.part.ts";
import { git, scratch } from "./scenarios.ts";
import { HELD } from "./spelled.ts";

const FIXES = "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n";
const REVIEWER_FIXES = "printf 'export const shaped = 3;\\n' >src/ticket-shape.ts\n";
const RED_FOUR_TIMES = ["n=$(cat ../reds 2>/dev/null || echo 0)", `[ "$n" -ge 4 ] && { ${CHECK_PASSES.trim()}; exit 0; }`, "echo $((n + 1)) >../reds", CHECK_RED].join("\n");
const FIXES_EACH_ROUND = "printf 'export const shaped = %s;\\n' \"$((CALL + 1))\" >src/ticket-shape.ts\n";
const MOVES_MAIN = 'git update-ref refs/heads/main "$(git commit-tree -p main -m "Land the reviewer fix #811 needed" "$(git rev-parse "main^{tree}")")"\n';
const FILED_IN_SESSION = "## Why\n\nThe owner: \"read what I said\".\n\nSession: `ca2517b0-5e2d-46e7-a894-7fc3a4b978b2` · [sessions](https://github.com/collod873/transcripts/blob/main/issues/claude-workflow-811.md)\n\n## Done when\n\n- The builder reads it.\n";
const FIXED_TICKET_NAMING = (files: string) => `## Why\n\nThe owner: "the fault sits in ${files}".\n\n## Done when\n\n- The builder clears a red ticket.\n`;
const APP_CLIENT_ID = "Iv23liAppClient";
const appKeyed = () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const file = join(scratch("app-key-"), "app-key.json");
  writeFileSync(file, JSON.stringify({ clientId: APP_CLIENT_ID, key: privateKey }));
  return { file, privateKey, publicKey };
};
const envOf = (dump: string | undefined, name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(dump ?? "")?.[1];
const githubHeaders = (dump: string | undefined) => {
  const held = (dump ?? "").split("--- github headers\n")[1]?.trimEnd().split("\n").filter((line) => line.startsWith("AUTHORIZATION") || line === "") ?? [];
  return held.slice(held.lastIndexOf("") + 1);
};
const claimsSignedBy = (jwt: string, publicKey: string) => {
  const [head = "", claims = "", signature = ""] = jwt.split(".");
  return createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, signature, "base64url") ? (JSON.parse(Buffer.from(claims, "base64url").toString("utf8")) as { iss?: string }) : undefined;
};
const untouched = ({ marked, handed, calls }: ReturnType<typeof fixing>) => {
  expect(marked()).toEqual([]);
  expect(handed()).toEqual([]);
  expect(calls().filter((args) => ["comment", "edit", "create", "close"].includes(args[1] ?? ""))).toEqual([]);
};

describe("the builder owns its ticket from build to land in one run (#898, ADR-0012)", () => {
  it("starts on a tree a red stage left dirty, and commits what is there with its fix, where #894 refused before any model", () => {
    const { run, handed, landed, closed, log } = fixing({ leftover: { "src/builder-turn.test.ts": "import { it } from \"vitest\";\n" }, claude: FIXES });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(2);
    expect(log("-1", "--name-only", "--format=%s").split("\n").filter((line) => line !== "")).toEqual(["Build #811 as its builder", "src/builder-turn.test.ts", "src/ticket-shape.ts"]);
    expect(landed()).toEqual([`${log("-1", "--format=%H")} --ticket 811 --approved it builds the Why`]);
    expect(closed()).toEqual(["811 9811"]);
  });

  it("builds a ticket marked building, commits it as a build, and once green hands it to review, lands it and closes it with the PR bin/land names (#931)", () => {
    const { run, handed, marked, landed, closed, log } = fixing({ claude: FIXES });

    const result = run("811");

    expect(result.status, result.stderr).toBe(0);
    expect(handed()[0]).toContain("## Build it");
    expect(handed()[0]).toContain("never the owner");
    expect(marked()).toEqual(["811 building", "811 checking"]);
    expect(log("-1", "--format=%s")).toBe("Build #811 as its builder");
    expect(landed()).toEqual([`${log("-1", "--format=%H")} --ticket 811 --approved it builds the Why`]);
    expect(closed()).toEqual(["811 9811"]);
  });

  it("opens a build pointing at `tdd`, leaving `check --full` to the machine outside its cap, carrying no build loop of its own, none of the contract's steps and none of the lines that never fired (#1477, Lumaria#1283)", () => {
    const contract = '{\n  "steps": {\n    "only-this-tree": { "run": "node src/gate.ts", "fast": true }\n  }\n}\n';
    const { run, handed } = fixing({ claude: FIXES, contract });

    expect(run("811").status).toBe(0);
    const opening = handed()[0] ?? "";
    expect(opening).toContain("Call the Skill tool with `tdd` and follow it to the end");
    expect(opening).not.toContain("Run `check --full` last");
    expect(opening).toContain("the machine commits whatever you left");
    expect(opening).not.toContain("only-this-tree");
    expect(opening).not.toMatch(/red before green|failing test/i);
    for (const dead of ["Read its Why first", "`gh` reads any run", "Test count drop", "Two rounds in a row", "`ticket`:"]) expect(opening).not.toContain(dead);
  });

  it("names, by number and title, the open tickets whose body names a file its own body names, where #1464's builder never saw #1462 (#1477)", () => {
    const body = FIXED_TICKET_NAMING("`src/builder.ts:111` and `specs.yml`");
    const openTickets = [
      { number: 1462, title: "Slice and research wait for one quick gate", body: "In `.github/workflows/specs.yml`, slice and research run on the build lane." },
      { number: 1459, title: "Evaluate the reviewer", body: "Its prompt sits in `src/builder.ts` beside the builder's." },
      { number: 1455, title: "Something apart", body: "Only `src/closer.ts` and builder.tsx." },
      { number: 811, title: "Build what the ticket asks", body },
    ];
    const { run, handed } = fixing({ claude: FIXES, body, openTickets });

    expect(run("811").status).toBe(0);
    const opening = handed()[0] ?? "";
    expect(opening).toContain("- #1462 Slice and research wait for one quick gate");
    expect(opening).toContain("- #1459 Evaluate the reviewer");
    expect(opening).not.toContain("#1455");
    expect(opening).not.toContain("- #811 ");
  });

  it("names no other tickets when none shares a file with its own", () => {
    const { run, handed } = fixing({ claude: FIXES, openTickets: [{ number: 1455, title: "Something apart", body: "Only `src/closer.ts`." }] });

    expect(run("811").status).toBe(0);
    expect(handed()[0]).not.toContain("#1455");
    expect(handed()[0]).not.toContain("Open tickets");
  });

  it("says where it cut a ticket longer than its cap (#1477)", () => {
    const { body } = fixing();
    const { run, handed } = fixing({ claude: FIXES, body: `${body}\n${"A further sentence the ticket goes on with.\n".repeat(400)}` });

    expect(run("811").status).toBe(0);
    expect(handed()[0]).toContain("[cut here, at its cap of 8192 bytes]");
    expect(handed()[0]?.indexOf("[cut here")).toBeLessThan(handed()[0]?.indexOf("## Build it") ?? 0);
  });



  it("runs the full check and publishes its receipts in the tree it builds in, reading only the verdict's last line", () => {
    const { run, landed, session } = fixing({ claude: SPENT_BY_THE_THIRD_ROUND + FIXES, stageMinutes: "1", check: `printf '%s %s\\n' "$(pwd -P)" "$*" >../ran\n${CHECK_PASSES}${CHECK_RED}` });

    expect(run().status).toBe(1);
    expect(readFileSync(join(session, "..", "ran"), "utf8").split("\n")[0]).toBe(`${realpathSync(session)} --full --publish`);
    expect(landed()).toEqual([]);
  });

  it("opens a build with the path of the capture of the session that filed its ticket, when the job holds it (#992)", () => {
    const captures = { "2026-09-27-ca2517b0.md": "the owner ruled out a second hook\n", "2026-09-27-deadbeef.md": "another session\n" };
    const building = fixing({ claude: FIXES, body: FILED_IN_SESSION, captures });

    expect(building.run("811").status).toBe(0);
    expect(building.handed()[0]).toContain(building.captured("2026-09-27-ca2517b0.md"));
    expect(building.handed()[0]).not.toContain("deadbeef");
  });

  it("names no capture when its ticket names no session, or the job does not hold the one it names (#992)", () => {
    const unnamed = fixing({ claude: FIXES, captures: { "2026-09-27-ca2517b0.md": "a capture\n" } });
    const unheld = fixing({ claude: FIXES, body: FILED_IN_SESSION, captures: { "2026-09-27-deadbeef.md": "another session\n" } });

    expect(unnamed.run("811").status).toBe(0);
    expect(unheld.run("811").status).toBe(0);
    expect(unnamed.handed()[0]).not.toContain(unnamed.captured(""));
    expect(unheld.handed()[0]).not.toContain(unheld.captured(""));
  });

  it("opens a woken split ticket with the newest closer comment naming how each piece ended, under its body (#1066)", () => {
    const older = "Every ticket #811 was split into has closed: #901 merged. #811 builds now.\n\nRun: 1";
    const newest = "Every ticket #811 was split into has closed: #901 merged, #902 closed unbuilt. #811 builds now.\n\nRun: 2";
    const { run, handed, body } = fixing({ claude: FIXES, onTicket: [older, "the split left #902 open", newest, { author: "stranger", type: "User", body: newest.replace("#902 closed unbuilt", "#903 merged") }] });

    expect(run("811").status).toBe(0);
    const opening = handed()[0] ?? "";
    expect(opening).toContain(newest);
    expect(opening).not.toContain(older);
    expect(opening).not.toContain("#903 merged");
    expect(opening.indexOf(newest)).toBeGreaterThan(opening.indexOf(body.trim()));
    expect(opening.indexOf(newest)).toBeLessThan(opening.indexOf("## Build it"));
  });

  it("opens a ticket no split woke as before (#1066)", () => {
    const { run, handed } = fixing({ claude: FIXES, onTicket: ["the owner says hello"] });

    expect(run("811").status).toBe(0);
    expect(handed()[0]).not.toContain("the owner says hello");
    expect(handed()[0]).not.toContain("split into has closed");
  });

  it("runs on Opus with no fence, every command in the foreground under a ten minute default, with nothing it could leave running after it answers, under the owner's own settings beside the repo's that no repo setting can switch his hooks off in", () => {
    const { run, hired } = fixing({ claude: FIXES });

    expect(run().status).toBe(0);
    const [argv] = hired();
    if (argv === undefined) throw new Error("no claude hired");
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
    expect(argv).not.toContain("--tools");
    expect(argv[argv.indexOf("--setting-sources") + 1]).toBe("user,project");
    expect(argv[argv.indexOf("--settings") + 1]).not.toContain("node");
    const { env, permissions, disableAllHooks } = JSON.parse(argv[argv.indexOf("--settings") + 1] ?? "{}") as { env: Record<string, string>; permissions: { deny: string[] }; disableAllHooks: boolean };
    expect(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("1");
    expect(env.BASH_DEFAULT_TIMEOUT_MS).toBe("600000");
    expect(permissions.deny).toEqual(expect.arrayContaining(["Agent", "Monitor", "Workflow", "ScheduleWakeup", "CronCreate", "RemoteTrigger"]));
    expect(disableAllHooks).toBe(false);
  });

  it("hands a red check back to the same session with the red step's part of the log its verdict names and that log's path, never the steps that passed beside it, then marks the ticket checking and lands it", () => {
    const { run, handed, hired, landed, marked } = fixing({ claude: FIXES_EACH_ROUND, check: FULL_CHECK_RED_ONCE });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(3);
    expect(handed()[1]).toContain("OTHER-TEST-BROKE in src/stops.test.ts");
    expect(handed()[1]).toContain(".git/check/logs/check-full-red.log");
    expect(handed()[1]).not.toContain("PASSING-STEP-LINE");
    expect(handed()[1]).not.toContain("TYPECHECK-FINE");
    expect(hired()[1]).toContain(BUILDER_SESSION);
    expect(landed()).toHaveLength(1);
    expect(marked()).toEqual(["811 building", "811 checking"]);
  });

  it("keeps going past three rounds while every round changes something", () => {
    const { run, handed, landed } = fixing({ claude: FIXES_EACH_ROUND, check: RED_FOUR_TIMES });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(6);
    expect(landed()).toHaveLength(1);
  });

  it("hands a check that stays red back round after round, changed or not, until the stage's time cap ends it, then calls the owner by name and lands nothing (#1477)", () => {
    const { run, handed, landed, marked, ticketComments } = fixing({ check: CHECK_RED, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" });

    const result = run();

    expect(result.status).toBe(1);
    expect(handed()[2]).toContain("check: red test src/stops.test.ts:4");
    expect(landed()).toEqual([]);
    expect(marked()).toContain("811 stuck");
    expect(ticketComments().at(-1)).toMatch(/^@collod873 /);
    expect(ticketComments().at(-1)).toContain("ran past its 1 minute cap");
  });

  it("resumes the session saved under `.claude/builder` from the builder's last job on this ticket, and saves the one it ends on there alone", () => {
    const { run, hired, keptSession } = fixing({ claude: FIXES, savedSession: "sess-earlier" });

    expect(run().status).toBe(0);
    const [argv] = hired();
    if (argv === undefined) throw new Error("no claude hired");
    expect(argv[argv.indexOf("--resume") + 1]).toBe("sess-earlier");
    expect(hired()[1], "the reviewer is a fresh session, never the builder's").not.toContain("--resume");
    expect(keptSession()).toBe(BUILDER_SESSION);
    expect(keptSession("fixer")).toBeUndefined();
  });


  it("refuses a rewrite that changes one byte of the Why, and posts one that changes only what done looks like, then checks, reviews and lands it as rewritten in the same round, never parked on the owner, where Lumaria #1015 and #1286 waited on him against ADR-0005 and 3 of 16 rewrites cost a round (#1477)", () => {
    const { body } = fixing();
    const refused = fixing({ answer: { outcome: "code", reason: "the Why reads better this way", body: body.replace("never the owner", "never The owner") }, claude: SPENT_BY_THE_THIRD_ROUND + FIXES, stageMinutes: "1" });

    expect(refused.run().status).toBe(1);
    expect(refused.edits()).toEqual([]);
    expect(refused.handed()[1]).toContain("Your rewrite of the ticket was refused");
    expect(refused.landed()).toEqual([]);

    const redone = body.replace("The builder clears a red ticket", "The builder clears a ticket red at any stage");
    const written = fixing({ answer: { outcome: "code", reason: "Done when named one stage where the Why means every stage", body: redone }, claude: FIXES });

    const result = written.run();

    expect(result.status, result.stderr).toBe(0);
    expect(written.edits()).toEqual([redone]);
    expect(written.ticketComments()[0]).toContain("The builder clears a ticket red at any stage");
    expect(written.ticketComments()[0]).toContain("where the Why means every stage");
    expect(written.marked()).not.toContain("811 waiting");
    expect(written.handed()).toHaveLength(2);
    expect(written.handed()[1], "the reviewer reads the ticket as rewritten").toContain("The builder clears a ticket red at any stage");
    expect(written.landed()).toHaveLength(1);
  });

  it("posts nothing for a `code` answer whose `body` is the ticket unchanged, and lands it", () => {
    const { body } = fixing();
    const { run, edits, landed } = fixing({ answer: { outcome: "code", reason: "it reads fine", body }, claude: FIXES });

    expect(run().status).toBe(0);
    expect(edits()).toEqual([]);
    expect(landed()).toHaveLength(1);
  });

  it("marks `stuck` with its reason a ticket the builder cannot build even rewritten, and lands nothing", () => {
    const { run, marked, ticketComments, landed } = fixing({ answer: { outcome: "stuck", reason: "the Why needs a runner this repo cannot reach" } });

    expect(run().status).toBe(1);
    expect(marked().at(-1)).toBe("811 stuck");
    expect(ticketComments().at(-1)).toContain("the Why needs a runner this repo cannot reach");
    expect(landed()).toEqual([]);
  });

  it("parks `waiting` on an open ticket it depends on, not `stuck`, and says so, where Mezzanine #1596 sat stuck six hours after #1592 merged (#1546)", () => {
    const { run, marked, ticketComments, landed } = fixing({ answer: { outcome: "waits", on: [1592], reason: "it builds on the parser #1592 adds" } });

    expect(run().status).toBe(0);
    expect(marked().at(-1)).toBe("811 waiting");
    expect(ticketComments().at(-1)).toContain("found it depends on #1592, still open");
    expect(landed()).toEqual([]);
  });

  it("refuses a `waits` answer on a ticket already closed, so it never waits for good", () => {
    const { run, marked, handed } = fixing({ answer: { outcome: "waits", on: [1590], reason: "it builds on #1590" }, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" });

    run();
    expect(marked()).not.toContain("811 waiting");
    expect(handed().join("\n")).toContain("#1590 is closed already");
  });

  it("hands a `code` answer on a branch with no commits past main back as nothing to land (#1195)", () => {
    const { run, landed, handed } = fixing({ claude: `${SPENT_BY_THE_THIRD_ROUND}git reset --quiet --hard main\n`, stageMinutes: "1" });

    expect(run().status).toBe(1);
    expect(landed()).toEqual([]);
    expect(handed()[1]).toContain("no commits past main");
  });

  it("hands a `code` answer whose only commit past main is main's merge commit amended back red, naming it, and never reviews it, where #1467's would have landed without its work (#1493)", () => {
    const mergedMain = [
      "side=$(git commit-tree -p main -m \"Land #1473\" \"$(git rev-parse 'main^{tree}')\")",
      "git update-ref refs/heads/main \"$(git commit-tree -p main -p \"$side\" -m \"Merge pull request #1473\" \"$(git rev-parse 'main^{tree}')\")\"",
      "git reset --quiet --hard main",
    ].join("\n");
    const amended = `if [ "$CALL" = 1 ]; then\n${mergedMain}\n${FIXES}git commit --quiet --amend -am "Merge pull request #1473"\nfi\n`;
    const { run, landed, handed, log } = fixing({ claude: `${SPENT_BY_THE_THIRD_ROUND}${amended}`, stageMinutes: "1" });

    expect(run().status).toBe(1);
    expect(landed()).toEqual([]);
    expect(handed().filter((prompt) => prompt.includes("## Fix it or approve it"))).toEqual([]);
    expect(handed()[1]).toContain(`${log("-1", "--format=%h")} Merge pull request #1473`);
    expect(handed()[1]).toContain("add its work as plain commits on top of main");
  });

  it("rewrites past `## Done when` when a builder corrects the body around it, and posts why (#942)", () => {
    const { body } = fixing();
    const corrected = `${body.replace("The builder clears a red ticket", "The builder clears a ticket red at any stage")}\n## Out of scope\n\n- The post door.\n`;
    const { run, edits, ticketComments } = fixing({ answer: { outcome: "code", reason: "the ticket named the shape rules, but the fault it names sits in src/post.ts", body: corrected }, claude: FIXES });

    expect(run().status).toBe(0);
    expect(edits()).toEqual([corrected]);
    expect(ticketComments()[0]).toContain("the fault it names sits in src/post.ts");
  });


  it("closes the ticket unbuilt with the reason, calling the owner by name, and runs no check and lands nothing", () => {
    const reason = "the ticket asks for a stage the ruling has since dropped";
    const { run, closes, ticketComments, labelled, landed, handed } = fixing({ answer: { outcome: "close", reason }, check: "touch ../checked\nexit 1\n" });

    expect(run().status).toBe(0);
    expect(closes()).toEqual([["issue", "close", "811", "--reason", "not planned"]]);
    expect(ticketComments().at(-1)).toMatch(new RegExp(`^@collod873 .*${reason}`));
    expect(labelled(), "leaves its labels to the close handler").toEqual([]);
    expect(landed()).toEqual([]);
    expect(handed()).toHaveLength(1);
  });

  it("closes a ticket whose work it finds already on main as completed, calling no one, where a landed ticket whose close failed was rebuilt and closed not planned (#1453)", () => {
    const reason = "PR #1431 landed this on main before its close failed";
    const { run, closes, ticketComments, marked, landed } = fixing({ answer: { outcome: "done", reason }, check: "touch ../checked\nexit 1\n" });

    expect(run().status).toBe(0);
    expect(closes()).toEqual([["issue", "close", "811", "--reason", "completed"]]);
    expect(ticketComments().at(-1)).toContain(reason);
    expect(ticketComments().join("\n")).not.toContain("@collod873");
    expect(marked()).not.toContain("stuck");
    expect(landed()).toEqual([]);
  });

  it("splits a ticket too big for one build into follow-up tickets that build themselves, and parks what must wait under `waiting`, where #910 was closed in silence", () => {
    const { body } = fixing();
    const waits = body.replace("The builder clears a red ticket", "The builder turns the flag on once its pieces merge");
    const reason = "it is two changes that build apart";
    const tickets = [
      { title: "Handle the misses in the shape rules", why: "The shape rules refuse a missing read by name.", done: ["Shape reads refuse by name."] },
      { title: "Handle the misses in the post door", why: "The post door refuses a missing read by name.", done: ["Post reads refuse by name."] },
    ];
    const { run, filed, edits, labelled, marked, closes, ticketComments, landed, handed, log } = fixing({ answer: { outcome: "split", reason, tickets, body: waits }, check: "touch ../checked\nexit 1\n" });

    expect(run().status).toBe(0);
    expect(filed()).toHaveLength(2);
    for (const [at, piece] of filed().entries()) {
      expect(piece).toMatch(/^## Why\n\nFollow-up of #811: its builder split it/);
      const ticket = tickets[at];
      if (ticket === undefined) throw new Error(`no ticket for filed piece ${at}`);
      expect(piece).toContain(`> ${ticket.why}`);
      expect(piece).toContain("> The owner, in session: \"a red ticket stays with its builder until it merges, never the owner\".");
      for (const sentence of ticket.done) expect(piece).toContain(`## Done when\n\n- ${sentence}`);
    }
    expect(edits()).toEqual([...filed().map((piece, at) => (piece ?? "").replace("## Done when", `[sessions](https://github.com/collod873/transcripts/blob/main/issues/claude-workflow-90${at + 1}.md)\n\n## Done when`)), waits]);
    expect(ticketComments().at(-1)).toMatch(new RegExp(`^@collod873 the builder split #811 into #901, #902, which build themselves\\..*${reason}`));
    expect(labelled()).toEqual([]);
    expect(marked()).toEqual(["811 building", "811 waiting"]);
    expect(closes()).toEqual([]);
    expect(log("-1", "--format=%s"), "drops what it built, which builds again once the pieces close").toBe("what the build stands on");
    expect(landed()).toEqual([]);
    expect(handed()).toHaveLength(1);
  });

  it("closes a split ticket with nothing left to wait, once its follow-ups are filed", () => {
    const tickets = [{ title: "Handle the misses in the shape rules", why: "The shape rules refuse a missing read by name.", done: ["Shape reads refuse by name."] }];
    const { run, filed, closes, ticketComments } = fixing({ answer: { outcome: "split", reason: "one piece holds all of it", tickets } });

    expect(run().status).toBe(0);
    expect(filed()).toHaveLength(1);
    expect(ticketComments().at(-1)).toMatch(/^@collod873 the builder split #811 into #901, which build themselves, and closed it/);
    expect(closes()).toEqual([["issue", "close", "811", "--reason", "not planned"]]);
  });

  it("files nothing and hands the split back when a follow-up says nothing about what done looks like", () => {
    const piece = { title: "Handle the misses", why: "The rules refuse a missing read by name.", done: [] };
    const unshaped = fixing({ answer: { outcome: "split", reason: "no Done when", tickets: [piece] }, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" });

    expect(unshaped.run().status).toBe(1);
    expect(unshaped.filed()).toEqual([]);
    expect(unshaped.handed()[1]).toContain("Handle the misses: '## Done when' says nothing");
  });

  it("will not split a follow-up again, so a chain of splits stops at one generation", () => {
    const { body } = fixing();
    const followUp = body.replace("The owner, in session:", "Follow-up of #700: its builder split it, since it does not fit one build.\n\n>");
    const piece = { title: "Handle the misses", why: "The rules refuse a missing read by name.", done: ["Reads refuse by name."] };
    const { run, filed, handed } = fixing({ body: followUp, answer: { outcome: "split", reason: "still too big", tickets: [piece] }, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" });

    expect(run().status).toBe(1);
    expect(filed()).toEqual([]);
    expect(handed()[1]).toContain("itself a follow-up, so it is not split again");
  });

  it("merges a machine fix it landed on main into the ticket, tells the owner, and hands the build back, landing nothing until it answers `code` (#1195)", () => {
    const reason = "the reviewer read a renamed export as drift";
    const answers = [{ outcome: "machine", reason }, { outcome: "code", reason: "built on the fix" }];
    const claude = `if [ "$CALL" = 1 ]; then ${MOVES_MAIN.trim()}; else ${FIXES.trim()}; printf '%s\\n' '${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "sess-fix", structured_output: answers[1] })}'; exit 0; fi\n`;
    const { run, ticketComments, landed, log, handed } = fixing({ answer: answers[0], claude });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(ticketComments()).toEqual([expect.stringMatching(new RegExp(`^@collod873 .*changed the machine: ${reason}`))]);
    expect(log("--format=%s")).toContain("Land the reviewer fix #811 needed");
    expect(handed()[1]).toContain("main now carries your machine fix");
    expect(landed()).toHaveLength(1);
  });


  it("will not take `machine` for an answer when main has not moved", () => {
    const { run, handed, landed } = fixing({ answer: { outcome: "machine", reason: "the reviewer is wrong" }, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" });

    expect(run().status).toBe(1);
    expect(handed()[1]).toContain("main has not moved");
    expect(landed()).toEqual([]);
  });

  const CALLER = "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main";
  const FAULT = { title: "Give the machine's check the database a tree's integration step needs", why: "The machine's check runs a tree's integration step with no database, so it is red whatever the code.", done: ["A tree's integration step runs against a database on the machine."] };

  it("files a machine fault found in a foreign tree as a ticket in the machine's repo, and parks its own ticket waiting on it, where Lumaria #828 landed a fix into Lumaria's main (#1143)", () => {
    const reason = "the machine's check has no database";
    const { run, createdIn, filed, ticketComments, marked, landed, closes, handed } = fixing({ calledFrom: CALLER, answer: { outcome: "machine", reason, tickets: [FAULT] }, claude: FIXES });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(createdIn()).toEqual(["collod873/claude-workflow"]);
    expect(filed()).toHaveLength(1);
    expect(filed()[0]).toMatch(/^## Why\n\nFiled by the builder of collod873\/Lumaria#811, which waits on it/);
    expect(filed()[0]).toContain(`> ${FAULT.why}`);
    expect(filed()[0]).toContain(`## Done when\n\n- ${FAULT.done[0]}`);
    expect(ticketComments().at(-1)).toMatch(new RegExp(`^The builder of #811 found the machine at fault and filed https://github.com/collod873/claude-workflow/issues/901\\. #811 waits on it.*${reason}`));
    expect(marked()).toEqual(["811 building", "811 waiting"]);
    expect(landed()).toEqual([]);
    expect(closes()).toEqual([]);
    expect(handed()).toHaveLength(1);
  });

  const KIT_STEP = { title: "Draw the address map from the place ID alone", why: "The kit's address map needs coordinates, so Lumaria cannot stop storing them.", done: ["The address map draws from a place ID with no coordinates."] };

  it("hands a first step another repo owns to that repo as a ticket, and parks its own ticket waiting on it, where Lumaria#1382 and #1393 sat stuck until the owner filed design-kit#191 and #193", () => {
    const reason = "the kit's map needs coordinates, so the fix starts in design-kit";
    const { run, createdIn, filed, ticketComments, marked, landed, handed } = fixing({ calledFrom: CALLER, answer: { outcome: "owned", repo: "collod873/design-kit", reason, tickets: [KIT_STEP] }, claude: FIXES });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(createdIn()).toEqual(["collod873/design-kit"]);
    expect(filed()[0]).toMatch(/^## Why\n\nFiled by the builder of collod873\/Lumaria#811, which waits on it, as its first step\.\n\n> The kit's address map/);
    expect(ticketComments().at(-1)).toMatch(new RegExp(`^The builder of #811 handed its first step to collod873/design-kit and filed https://github.com/collod873/design-kit/issues/901\\. #811 waits on it, labelled \`waiting\`, and the closer wakes it once every one of them closes: ${reason}`));
    expect(marked()).toEqual(["811 building", "811 waiting"]);
    expect(landed()).toEqual([]);
    expect(handed()).toHaveLength(1);
  });

  it("calls the owner on a first step handed to a repo with no caller file, since nothing there hears it close", () => {
    const { run, ticketComments, marked } = fixing({ calledFrom: CALLER, answer: { outcome: "owned", repo: "collod873/design-kit", reason: "the fix starts in design-kit", tickets: [KIT_STEP] }, claude: FIXES, unheardIn: "collod873/design-kit" });

    expect(run().status).toBe(0);
    expect(ticketComments().at(-1)).toMatch(/^The builder of #811 handed its first step to collod873\/design-kit and filed https:\/\/github.com\/collod873\/design-kit\/issues\/901\. #811 waits on it, labelled `waiting`\. @collod873 collod873\/design-kit carries no caller file, so nothing hears it close: take `waiting` off #811 once every one of them closes:/);
    expect(marked()).toEqual(["811 building", "811 waiting"]);
  });

  it("hands back a first step named for its own repo, or for no repo, filing nothing", () => {
    const own = fixing({ calledFrom: CALLER, answer: { outcome: "owned", repo: "collod873/Lumaria", reason: "the fix starts here", tickets: [KIT_STEP] }, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" });
    const none = fixing({ calledFrom: CALLER, answer: { outcome: "owned", reason: "the fix starts elsewhere", tickets: [KIT_STEP] }, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" });

    expect(own.run().status).toBe(1);
    expect(own.filed()).toEqual([]);
    expect(own.handed()[1]).toContain("collod873/Lumaria is this ticket's own repo");
    expect(none.run().status).toBe(1);
    expect(none.filed()).toEqual([]);
    expect(none.handed()[1]).toContain("names the repo that owns its first step as `repo`");
  });

  it("tells a builder in a foreign tree to file a machine fault here, not to land it on the tree's main (#1143)", () => {
    const { run, handed } = fixing({ calledFrom: CALLER, claude: FIXES });

    expect(run().status).toBe(0);
    expect(handed()[0]).not.toContain("`bin/land` it first");
    expect(handed()[0]).toContain("file the fault as `tickets`");
  });

  const HOME_CALLER = "collod873/claude-workflow/.github/workflows/machine.yml@refs/heads/main";

  it("lands a `machine` answer on main when its caller file is in the machine's own repo, filing nothing, as this repo's own workflows do (#1215)", () => {
    const answers = [{ outcome: "machine", reason: "the reviewer read a renamed export as drift" }, { outcome: "code", reason: "built on the fix" }];
    const claude = `if [ "$CALL" = 1 ]; then ${MOVES_MAIN.trim()}; else ${FIXES.trim()}; printf '%s\\n' '${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "sess-fix", structured_output: answers[1] })}'; exit 0; fi\n`;
    const { run, filed, log, handed, landed } = fixing({ calledFrom: HOME_CALLER, repo: "collod873/claude-workflow", answer: answers[0], claude });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()[0]).toContain("`bin/land`");
    expect(filed()).toEqual([]);
    expect(log("--format=%s")).toContain("Land the reviewer fix #811 needed");
    expect(landed()).toHaveLength(1);
  });


  it("hands back a `machine` answer from a foreign tree that files no ticket (#1143)", () => {
    const { run, filed, handed, marked } = fixing({ calledFrom: CALLER, answer: { outcome: "machine", reason: "the check has no database" }, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" });

    expect(run().status).toBe(1);
    expect(filed()).toEqual([]);
    expect(marked()).not.toContain("811 waiting");
    expect(handed()[1]).toContain("files the machine's fault as one ticket or more in `tickets`");
  });


  it("hands a fresh session the ticket again with the red when resuming its own session fails", () => {
    const resumeFails = 'if printf \'%s\\n\' "$@" | grep -qx -- --resume; then printf \'No conversation found\\n\' >&2; exit 1; fi\n';
    const { run, handed } = fixing({ claude: resumeFails + FIXES_EACH_ROUND, check: FULL_CHECK_RED_ONCE });

    expect(run().status).toBe(0);
    expect(handed().at(-2)).toContain("never the owner");
    expect(handed().at(-2)).toContain("OTHER-TEST-BROKE in src/stops.test.ts");
  });

  it("names in its log why the session of its last run was refused before it starts fresh (#1180)", () => {
    const resumeFails = 'if printf \'%s\\n\' "$@" | grep -qx -- --resume; then printf \'No conversation found with session ID: sess-built\\n\' >&2; exit 1; fi\n';
    const { run } = fixing({ claude: resumeFails + FIXES, savedSession: "sess-built" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("fix: #811 could not resume its builder's session sess-built, so it starts fresh: the builder ended 1: No conversation found with session ID: sess-built");
  });


  it("calls the owner and closes nothing when its own model call fails twice (#862)", () => {
    const { run, closes, ticketComments, marked } = fixing({ claude: "printf 'the model overloaded\\n' >&2\nexit 1\n" });

    expect(run().status).toBe(1);
    expect(closes()).toEqual([]);
    expect(marked()).toContain("811 stuck");
    expect(ticketComments().at(-1)).toContain("the model overloaded");
  });

});

describe("a fresh reviewer reads each green build, fixes or approves it, and bin/land lands it in the same run (ADR-0012)", () => {
  const LAND_REFUSES_ONCE = "[ -f ../land-refused ] || { touch ../land-refused; printf 'land: the commit subject carries an em dash\\n' >&2; exit 1; }\n";
  const STEP = { title: "Set the Stripe key in the dashboard", why: "Payments run only once the live key is set." };

  it("hires a second session on Opus that resumes nothing, handed the ticket, its commits and its diff from main", () => {
    const { run, handed, hired, body } = fixing({ claude: FIXES });

    expect(run().status).toBe(0);
    const review = handed()[1] ?? "";
    expect(review).toMatch(/^# Review #811 before it lands/);
    expect(review).toContain(body.trim());
    expect(review).toContain("- Build #811 as its builder");
    expect(review).toContain("+export const shaped = 2;");
    const argv = hired()[1] ?? [];
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
    expect(argv).not.toContain("--resume");
  });

  it("tells the reviewer to load coding-standards beside testing and leaves the full check to bin/land, where 0 of 15 reviewers loaded it and 5 ran a check bin/land repeated (#1484)", () => {
    const { run, handed } = fixing({ claude: FIXES });

    expect(run().status).toBe(0);
    const review = handed()[1] ?? "";
    expect(review).toContain("call the Skill tool with `coding-standards` for the code standard and `testing` for the test standard");
    expect(review).toContain("`bin/land` then runs the full check and merges it, and anything it refuses comes back to you");
    expect(review).not.toContain("check --full");
    expect(review).not.toContain("Two rounds in a row");
  });

  it("names to the reviewer the open tickets on the same files the builder was handed, where #1464's reviewer let through a cost #1462 owned (#1484)", () => {
    const body = FIXED_TICKET_NAMING("`src/reviewer.ts`");
    const openTickets = [
      { number: 1462, title: "Slice and research wait for one quick gate", body: "The cost sits in `src/reviewer.ts`." },
      { number: 1455, title: "Something apart", body: "Only `src/closer.ts`." },
    ];
    const { run, handed } = fixing({ claude: FIXES, body, openTickets });

    expect(run().status).toBe(0);
    const review = handed()[1] ?? "";
    expect(review).toContain("## Open tickets on the same files");
    expect(review).toContain("- #1462 Slice and research wait for one quick gate");
    expect(review).not.toContain("#1455");
  });

  it("hands a diff over DIFF_CAP as its stat and every changed file, with no part of the diff, where 6 of 7 cut diffs were read again (#1484)", () => {
    const { run, handed } = fixing({ claude: `${FIXES}seq 1 9000 | sed 's/^/oversized /' >src/oversized.ts\n` });

    expect(run().status).toBe(0);
    const review = handed()[1] ?? "";
    expect(review).toMatch(/src\/oversized\.ts +\| 9000 \+{3,}/);
    expect(review).toContain("Every file changed:\n\n- src/oversized.ts\n- src/ticket-shape.test.ts\n- src/ticket-shape.ts\n");
    expect(review).not.toContain("+oversized 1\n");
    expect(review).not.toContain("+export const shaped = 2;");
  });

  it("commits what the reviewer fixes as a review, and lands that head", () => {
    const { run, log, landed, closed } = fixing({ claude: FIXES, reviewer: REVIEWER_FIXES });

    expect(run().status).toBe(0);
    expect(log("-2", "--format=%s").split("\n")).toEqual(["Review #811 as its reviewer", "Build #811 as its builder"]);
    expect(landed()).toEqual([`${log("-1", "--format=%H")} --ticket 811 --approved it builds the Why`]);
    expect(closed()).toEqual(["811 9811"]);
  });

  it("calls the owner by name when the reviewer answers stuck, and lands and closes nothing", () => {
    const { run, marked, ticketComments, landed, closed } = fixing({ claude: FIXES, review: { outcome: "stuck", reason: "the diff builds a different Why" } });

    expect(run().status).toBe(1);
    expect(marked()).toEqual(["811 building", "811 checking", "811 stuck"]);
    expect(ticketComments().at(-1)).toBe("@collod873 the reviewer of #811 stopped and needs you: the diff builds a different Why");
    expect(landed()).toEqual([]);
    expect(closed()).toEqual([]);
  });

  it("hands what bin/land refuses back to the reviewer's own session, never the builder, and lands once it passes", () => {
    const { run, handed, hired, landed, closed } = fixing({ claude: FIXES, reviewer: REVIEWER_FIXES, land: LAND_REFUSES_ONCE });

    expect(run().status).toBe(0);
    expect(handed()).toHaveLength(3);
    expect(handed()[2]).toContain("`bin/land` refused to land it");
    expect(handed()[2]).toContain("the commit subject carries an em dash");
    expect(hired()[2]?.join(" ")).toContain('"approve"');
    expect(hired()[2]).toContain(BUILDER_SESSION);
    expect(landed()).toHaveLength(2);
    expect(closed()).toEqual(["811 9811"]);
  });

  it("lands and closes on an App token minted before each bin/land, signed by a key the builder took off disk before any model ran, where Lumaria#1332's push failed on credentials past its job's first hour (#1504)", () => {
    const { file, privateKey, publicKey } = appKeyed();
    const { run, session, ranWith, calls } = fixing({ claude: FIXES, reviewer: REVIEWER_FIXES, land: LAND_REFUSES_ONCE, appKeyFile: file });
    git(session, "config", "http.https://github.com/.extraheader", "AUTHORIZATION: basic job-token");

    const result = run();
    expect(result.status, result.stderr).toBe(0);
    const [refused, landed] = ranWith("land");
    const [closed] = ranWith("close");
    const token = envOf(landed, "GH_TOKEN");
    expect(token).toMatch(/^minted-\d+$/);
    expect(envOf(refused, "GH_TOKEN")).toMatch(/^minted-\d+$/);
    expect(envOf(refused, "GH_TOKEN")).not.toBe(token);
    expect(githubHeaders(landed)).toEqual([`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`]);
    expect([envOf(closed, "GH_TOKEN"), envOf(closed, "QUIET_GH_TOKEN")]).toEqual([token, token]);
    const bearers = calls().flatMap((args) => args.filter((arg) => arg.startsWith("Authorization: Bearer ")).map((arg) => arg.slice("Authorization: Bearer ".length)));
    expect(bearers.length).toBeGreaterThan(0);
    for (const jwt of bearers) expect(claimsSignedBy(jwt, publicKey)?.iss).toBe(APP_CLIENT_ID);
    const models = ranWith("claude");
    expect(models).toHaveLength(3);
    for (const model of models) {
      expect(model).not.toContain(privateKey.split("\n")[1]);
      expect(model).not.toContain(APP_CLIENT_ID);
    }
  });

  it("marks checking and calls the owner on an App token minted after the model that ran before each, so a reviewer answering stuck past the job's first hour still reaches the owner (#1504)", () => {
    const { run, ranWith, marked } = fixing({ claude: FIXES, review: { outcome: "stuck", reason: "the diff builds a different Why" }, appKeyFile: appKeyed().file });

    const result = run();

    expect(marked()).toEqual(["811 building", "811 checking", "811 stuck"]);
    const [building, checking, stuck] = ranWith("mark").map((dump) => envOf(dump, "GH_TOKEN"));
    expect(building).toBe("job-token");
    expect(checking).toMatch(/^minted-\d+$/);
    expect(stuck).toMatch(/^minted-\d+$/);
    expect(stuck, result.stderr).not.toBe(checking);
  });

  it("ends red at unread, landing nothing, when no fresh App token can be minted after the builder ran (#1504)", () => {
    const { run, landed } = fixing({ claude: FIXES, appKeyFile: appKeyed().file, unreadable: '*"access_tokens"*' });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("a fresh App token could not be minted");
    expect(landed()).toEqual([]);
  });

  it("calls the owner when bin/land refuses twice in a row and the reviewer changes nothing", () => {
    const { run, marked, ticketComments, closed } = fixing({ claude: FIXES, land: "printf 'land: the full check is red\\n' >&2\nexit 1\n" });

    expect(run().status).toBe(1);
    expect(marked().at(-1)).toBe("811 stuck");
    expect(ticketComments().at(-1)).toMatch(/^@collod873 the reviewer of #811 stopped and needs you: two rounds in a row changed nothing: .*the full check is red/);
    expect(closed()).toEqual([]);
  });

  it("counts a round its reviewer changed nothing in as idle though bin/land rebased the branch onto a main that moved", () => {
    const REBASES_THEN_REFUSES = [
      "moved=$(cat ../main-moves 2>/dev/null || echo 0); echo $((moved + 1)) >../main-moves",
      'if [ "$moved" -lt 2 ]; then git update-ref refs/remotes/origin/main "$(git commit-tree -p origin/main -m "another ticket landed" "origin/main^{tree}")"; git rebase --quiet origin/main; fi',
      "printf 'land: the full check is red\\n' >&2; exit 1",
      "",
    ].join("\n");
    const { run, handed, ticketComments } = fixing({ claude: FIXES, land: REBASES_THEN_REFUSES });

    expect(run().status).toBe(1);
    expect(handed(), "the builder's round and the reviewer's two").toHaveLength(3);
    expect(ticketComments().at(-1)).toContain("two rounds in a row changed nothing");
  });

  it("leaves a ticket whose reviewer's model call fails twice unmarked and the owner uncalled, and ends red so the machine re-runs it", () => {
    const { run, marked, ticketComments, landed } = fixing({ claude: FIXES, reviewer: "printf 'the model overloaded\\n' >&2\nexit 1\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the model overloaded");
    expect(marked()).not.toContain("811 stuck");
    expect(ticketComments().filter((said) => said?.includes("needs you"))).toEqual([]);
    expect(landed()).toEqual([]);
  });

  it("gives the reviewer's next round its whole cap however long bin/land's full check took", () => {
    const LAND_CHECKS_PAST_THE_CAP_THEN_REFUSES = "[ -f ../land-refused ] || { touch ../land-refused; sleep 4; printf 'land: the full check is red\\n' >&2; exit 1; }\n";
    const { run, capped, landed } = fixing({ claude: FIXES, land: LAND_CHECKS_PAST_THE_CAP_THEN_REFUSES, stageMinutes: "0.05" });

    expect(run().status).toBe(0);
    expect(landed()).toHaveLength(2);
    expect(capped(), "the builder's round and the reviewer's two, in seconds").toEqual(["3", "3", "3"]);
  });

  it("files each step the reviewer names as an owner-step note once it lands, and still closes the ticket, never asking the builder for one, where #1441 and #1442 filed one step twice (ADR-0005, #1453)", () => {
    const { run, filed, calls, closed, hired } = fixing({ claude: FIXES, review: { outcome: "approve", reason: "it builds the Why", steps: [STEP] } });

    expect(run().status).toBe(0);
    const builder = hired()[0] ?? [];
    expect(builder).toContain("--json-schema");
    expect(builder[builder.indexOf("--json-schema") + 1]).not.toContain('"steps"');
    expect(filed()).toHaveLength(1);
    expect(filed()[0]).toContain(STEP.why);
    expect(filed()[0]).toContain("Left to the owner by the run that built #811, which closed.");
    expect(calls().find((args) => args[1] === "create")).toEqual(expect.arrayContaining(["owner-step", STEP.title]));
    expect(closed()).toEqual(["811 9811"]);
  });

  it("lands nothing, and ends green keeping the branch, when the ticket is held by the time its review ends", () => {
    const { run, landed, closed } = fixing({ claude: FIXES, reviewer: "printf 'paused\\n' >>../labels\n" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("review: #811 is labelled paused, so it does not land");
    expect(landed()).toEqual([]);
    expect(closed()).toEqual([]);
  });

  it("ends red at unread, landing nothing, when the ticket's labels cannot be read at review", () => {
    const { run, landed } = fixing({ claude: FIXES, unreadable: '*"issue view"*"labels"*"--jq"*' });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the labels of #811 could not be read");
    expect(landed()).toEqual([]);
  });
});

describe("the builder builds an App-opened ticket only as a follow-up a stage wrote, never for its spec alone (#1022, #1509)", () => {
  const SPEC = { state: "open", user: { login: "collod873" }, labels: [{ name: "spec" }] };
  const APP = "collod873-machine[bot]";

  it("stops a ticket the App opened under an open spec the owner opened, before its builder runs anything", () => {
    const scenario = fixing({ claude: FIXES, opener: APP, parent: SPEC });

    const result = scenario.run("811");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("#811");
    expect(result.stderr).toContain("as no follow-up the machine builds");
    expect(scenario.handed()).toEqual([]);
    expect(scenario.marked()).toEqual([]);
  });

  it("builds the owner's own ticket under no spec, as before", () => {
    const { run, handed } = fixing({ claude: FIXES });

    expect(run("811").status).toBe(0);
    expect(handed()).toHaveLength(2);
  });
});

describe("bin/fix stops at a mark GitHub refused, so it hires no model on a ticket whose labels lag (#1107)", () => {
  it("ends red at the building mark, naming the stage, the label and the ticket, and hires, posts and marks nothing after it", () => {
    const { run, marked, handed, calls } = fixing({ claude: FIXES, markRefusal: "mark: #811 not labelled building: HTTP 403: Resource not accessible by integration" });

    const { status, stderr } = run("811");

    expect(status).toBe(1);
    expect(stderr).toContain("fix: bin/mark #811 building ended non-zero, so nothing after it is posted, closed, marked or hired\n");
    expect(marked()).toEqual(["811 building"]);
    expect(handed()).toEqual([]);
    expect(calls().filter((args) => args[0] === "issue" && args[1] !== "view")).toEqual([]);
  });
});

describe("bin/fix reads its ticket, its labels and its comments before it marks anything, and ends red at a read that fails (#1112)", () => {
  const READS = [
    { read: "its ticket", unreadable: '*"issue view"*', line: "#811 could not be read, so no label changed and no model was hired" },
    { read: "the log directory", gitUnreadable: '*"--git-common-dir"*', line: "the log directory could not be named by git, so no model was hired" },
    { read: "its ticket's comments", unreadable: '*"issues/811/comments"*', line: "the comments on #811 could not be read, so nothing is marked" },
  ];

  it.each(READS)("ends red at unread naming $read, marking, posting and hiring nothing", ({ line, ...reads }) => {
    const unread = fixing({ claude: FIXES, ...reads });

    expect(unread.run()).toMatchObject({ status: 1, stderr: `fix: ${line}\n` });
    untouched(unread);
  });

});

describe("bin/fix opens through the one stage opening (#1117)", () => {
  for (const held of HELD) {
    it(`ends green in one line on a ticket marked ${held}, and changes no label and hires no model (#1166)`, () => {
      const stopped = fixing({ claude: FIXES, labels: ["ticket", held] });

      expect(stopped.run("811")).toEqual({ status: 0, stdout: `fix: #811 is marked ${held}, so no label changed and no model was hired\n`, stderr: "" });
      untouched(stopped);
    });
  }

  it("refuses an unadmitted ticket after the stuck rule, so a stopped ticket stays green", () => {
    const { run, marked } = fixing({ claude: FIXES, opener: "collod873-machine[bot]", labels: ["ticket", "stuck"] });

    expect(run("811")).toMatchObject({ status: 0, stderr: "" });
    expect(marked()).toEqual([]);
  });
});

describe("the builder builds another repo's checkout from this repo's bin/ (#1134)", () => {
  const READIED = '{ "setup": "touch ../readied", "steps": {} }\n';
  const SEES_READIED = "[ -e ../readied ] && printf 'readied\\n' >>../hired-readied\n";
  const COMMITLINTED = { "commitlint.config.js": "export default { extends: ['@commitlint/config-conventional'] };\n" };

  it("readies the tree with its contract's setup before the hire, and judges it and calls gh from that tree", () => {
    const { run, session, ranIn, landed, marked } = fixing({ contract: READIED, claude: `${SEES_READIED}${FIXES}` });

    const result = run("811");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(session, "..", "hired-readied"), "utf8")).toBe("readied\n");
    expect(ranIn()).toEqual(expect.arrayContaining([`gh ${realpathSync(session)}`, `check ${realpathSync(session)}`, `claude ${realpathSync(session)}`]));
    expect(ranIn().every((line) => line.endsWith(realpathSync(session)))).toBe(true);
    expect(marked()).toEqual(["811 building", "811 checking"]);
    expect(landed()).toHaveLength(1);
  });

  it("runs the tree's setup, its check and its builder's commands on the Node and package manager the tree pins, and itself and the builder's node launcher on the machine's own Node (#1138)", () => {
    const pinned = { node: "printf 'v20.0.0\\n'\n", pnpm: "printf 'pnpm %s\\n' \"$*\" >>../pinned-ran\n" };
    const sees = (who: string) => `printf '${who} %s %s\\n' "$(node --version)" "$(command -v pnpm >/dev/null && echo pnpm)" >>../pinned-ran\n`;
    const { run, session } = fixing({ contract: '{ "setup": "pnpm install --frozen-lockfile && node --version >>../pinned-ran", "steps": {} }\n', claude: `${sees("builder")}${FIXES}`, check: `${sees("check")}${CHECK_PASSES}`, treePath: pinned, nodeLauncher: true });

    const result = run("811");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(session, "..", "pinned-ran"), "utf8").trim().split("\n")).toEqual(["pnpm install --frozen-lockfile", "v20.0.0", `launcher ${process.version}`, "builder v20.0.0 pnpm", "check v20.0.0 pnpm", `launcher ${process.version}`]);
  });

  it("calls the owner and hires no one when its contract's setup fails", () => {
    const { run, handed, marked, ticketComments } = fixing({ contract: '{ "setup": "echo no lockfile >&2; exit 3", "steps": {} }\n', claude: FIXES });

    expect(run("811").status).toBe(1);
    expect(handed()).toEqual([]);
    expect(marked()).toEqual(["811 building", "811 stuck"]);
    expect(ticketComments()).toEqual([expect.stringContaining("its tree's setup failed: no lockfile")]);
  });

  it("writes a build commit the repo's commitlint accepts when the repo carries one", () => {
    const { run, log, handed } = fixing({ onMain: COMMITLINTED, claude: FIXES });

    expect(run("811").status).toBe(0);
    expect(log("-1", "--format=%s")).toBe("feat: build #811 as its builder");
    expect(handed()[0]).toContain("commitlint");
  });

  it("writes a review commit the repo's commitlint accepts when the repo carries one", () => {
    const { run, log } = fixing({ onMain: COMMITLINTED, claude: FIXES, reviewer: REVIEWER_FIXES });

    expect(run().status).toBe(0);
    expect(log("-1", "--format=%s")).toBe("fix: review #811 as its reviewer");
  });

  it("keeps this repo's messages, and tells its builder nothing of commitlint, when the repo carries none", () => {
    const { run, log, handed } = fixing({ claude: FIXES });

    expect(run("811").status).toBe(0);
    expect(log("-1", "--format=%s")).toBe("Build #811 as its builder");
    expect(handed()[0]).not.toContain("commitlint");
  });
});
