import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILDER_SESSION, CHECK_PASSES, CHECK_RED, FULL_CHECK_RED_ONCE, fixing } from "./builder.part.ts";

const DRIFT = "The reviewer read this PR against the Why of #811 and found drift.\n\n- src/builder.ts never resumes its session\n";
const FIXES = "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n";
const RED_FOUR_TIMES = ["n=$(cat ../reds 2>/dev/null || echo 0)", `[ "$n" -ge 4 ] && { ${CHECK_PASSES.trim()}; exit 0; }`, "echo $((n + 1)) >../reds", CHECK_RED].join("\n");
const FIXES_EACH_ROUND = "printf 'export const shaped = %s;\\n' \"$((CALL + 1))\" >src/ticket-shape.ts\n";
const MOVES_MAIN = 'git update-ref refs/heads/main "$(git commit-tree -p main -m "Land the reviewer fix #811 needed" "$(git rev-parse "main^{tree}")")"\n';
const FILED_IN_SESSION = "## Why\n\nThe owner: \"read what I said\".\n\nSession: `ca2517b0-5e2d-46e7-a894-7fc3a4b978b2`\n\n## Done when\n\n- The builder reads it.\n";
const untouched = ({ marked, handed, calls }: ReturnType<typeof fixing>) => {
  expect(marked()).toEqual([]);
  expect(handed()).toEqual([]);
  expect(calls().filter((args) => ["comment", "edit", "create", "close"].includes(args[1] ?? ""))).toEqual([]);
};
const woken = (reason: string) => {
  const { run, handed } = fixing({ reason, claude: FIXES });
  return { result: run("811"), prompt: handed()[0] };
};

describe("the builder owns a red ticket until it merges (#898)", () => {
  it("starts on a tree a red stage left dirty, and commits what is there with its fix, where #894 refused before any model", () => {
    const { run, handed, saved, log } = fixing({ leftover: { "src/builder-turn.test.ts": "import { it } from \"vitest\";\n" }, claude: FIXES });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(1);
    expect(log("-1", "--name-only", "--format=%s").split("\n").filter((line) => line !== "")).toEqual(["Repair #811 as its builder", "src/builder-turn.test.ts", "src/ticket-shape.ts"]);
    expect(saved()).toEqual(["811"]);
  });

  it("builds a ticket nothing has failed on yet, marked building and committed as a build, and pushes once green (#931)", () => {
    const { run, handed, marked, saved, log } = fixing({ claude: FIXES });

    const result = run("811");

    expect(result.status, result.stderr).toBe(0);
    expect(handed()[0]).toContain("## Build it");
    expect(handed()[0]).toContain("never the owner");
    expect(handed()[0]).not.toContain("## How it failed");
    expect(marked()).toEqual(["811 building", "811 checking"]);
    expect(log("-1", "--format=%s")).toBe("Build #811 as its builder");
    expect(saved()).toEqual(["811"]);
  });

  it("opens a build with the whole of the contract's steps as they stand in the tree it builds in, whatever repo that is (#990)", () => {
    const contract = '{\n  "steps": {\n    "only-this-tree": { "run": "node src/gate.ts", "fast": true }\n  }\n}\n';
    const { run, handed } = fixing({ claude: FIXES, contract });

    expect(run("811").status).toBe(0);
    expect(handed()[0]).toContain(contract.trim());
    expect(handed()[0]).toContain("~/bin/check --full");
  });

  it("passes a foreign tree whose check is red only for steps the runner lacks what they need for, leaving them to its own CI, and keeps this repo's own check judging them (#1142)", () => {
    const unmet = "printf 'check: red integration (needs DATABASE_URL), e2e (needs BASE_URL, TOKEN); log /nowhere/check-full.log\\n'\nexit 1\n";
    const foreign = fixing({ claude: FIXES, check: unmet, calledFrom: "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main" });
    const own = fixing({ claude: FIXES, check: unmet });

    expect(foreign.run("811").status).toBe(0);
    expect(foreign.saved()).toEqual(["811"]);
    expect(foreign.marked()).toEqual(["811 building", "811 checking"]);
    expect(foreign.handed()[0]).toContain("`<step> (needs <VAR>)`");
    expect(own.run("811").status).toBe(1);
    expect(own.saved()).toEqual([]);
    expect(own.handed()[0]).not.toContain("(needs <VAR>)");
  });

  it("reads the unmet need off the real check's verdict, which names it red in CI, and opens the foreign tree's PR in its own repo through the real save, as taking waiting off Lumaria #828 asks (#1142, #1146)", () => {
    const real = realpathSync(join(homedir(), "bin", "check"));
    const contract = '{ "steps": { "integration": { "run": "true", "needs": ["DATABASE_URL"] } } }\n';
    const check = `env -u DATABASE_URL CI=true "${real}" "$@" | tee -a ../check-out\nexit "\${PIPESTATUS[0]}"\n`;
    const { run, saved, opened, calls, session } = fixing({ claude: FIXES, contract, check, realSave: true, reason: "waiting came off", calledFrom: "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main" });

    const result = run("811");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(session, "..", "check-out"), "utf8")).toMatch(/^check: red integration \(needs DATABASE_URL\)/m);
    expect(saved()).toEqual(["811"]);
    expect(opened()).toEqual(["collod873/Lumaria https://github.com/collod873/Lumaria/pull/9811"]);
    expect(calls().filter((args) => args[0] === "pr").map((args) => args.slice(0, 3).join(" "))).toEqual(["pr view ticket/811", "pr create --base", "pr merge ticket/811"]);
  });

  it("holds a foreign tree red when anything beside an unmet need is red (#1142)", () => {
    const mixed = "printf 'check: red test src/stops.test.ts:4, integration (needs DATABASE_URL); log /nowhere/check-full.log\\n'\nexit 1\n";
    const { run, saved } = fixing({ claude: FIXES, check: mixed, calledFrom: "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main" });

    expect(run("811").status).toBe(1);
    expect(saved()).toEqual([]);
  });

  it("hands a builder woken on a red no copy of the contract (#990)", () => {
    const contract = '{ "steps": { "only-this-tree": { "run": "node src/gate.ts" } } }\n';
    const { run, handed } = fixing({ reason: "the Check went red", claude: FIXES, contract });

    expect(run("811").status).toBe(0);
    expect(handed()[0]).not.toContain("only-this-tree");
  });

  it("runs the full check and publishes its receipts in the tree it builds in, reading only the verdict's last line", () => {
    const { run, saved, session } = fixing({ claude: FIXES, check: `printf '%s %s\\n' "$(pwd -P)" "$*" >../ran\n${CHECK_PASSES}${CHECK_RED}` });

    expect(run().status).toBe(1);
    expect(readFileSync(join(session, "..", "ran"), "utf8")).toBe(`${realpathSync(session)} --full --publish\n`);
    expect(saved()).toEqual([]);
  });

  it("opens a build and a red with the path of the capture of the session that filed its ticket, when the job holds it (#992)", () => {
    const body = FILED_IN_SESSION;
    const captures = { "2026-09-27-ca2517b0.md": "the owner ruled out a second hook\n", "2026-09-27-deadbeef.md": "another session\n" };
    const building = fixing({ claude: FIXES, body, captures });
    const red = fixing({ reason: "the Check went red", claude: FIXES, body, captures });

    expect(building.run("811").status).toBe(0);
    expect(red.run("811").status).toBe(0);
    expect(building.handed()[0]).toContain(building.captured("2026-09-27-ca2517b0.md"));
    expect(red.handed()[0]).toContain(red.captured("2026-09-27-ca2517b0.md"));
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

  it("runs on Opus with no fence, the owner's hooks its only guard", () => {
    const { run, hired } = fixing({ claude: FIXES });

    expect(run().status).toBe(0);
    const [argv] = hired();
    if (argv === undefined) throw new Error("no claude hired");
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
    expect(argv).not.toContain("--tools");
    expect(argv[argv.indexOf("--settings") + 1]).not.toContain("node");
  });

  it("hands a red check back to the same session with the log its verdict names, then commits, pushes and marks the ticket checking", () => {
    const { run, handed, hired, saved, marked } = fixing({ claude: FIXES_EACH_ROUND, check: FULL_CHECK_RED_ONCE });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(2);
    expect(handed()[1]).toContain("OTHER-TEST-BROKE in src/stops.test.ts");
    expect(hired()[1]).toContain(BUILDER_SESSION);
    expect(saved()).toEqual(["811"]);
    expect(marked()).toEqual(["811 building --try", "811 checking"]);
  });

  it("keeps going past three rounds while every round changes something", () => {
    const { run, handed, saved } = fixing({ claude: FIXES_EACH_ROUND, check: RED_FOUR_TIMES });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(5);
    expect(saved()).toEqual(["811"]);
  });

  it("calls the owner by name, and pushes nothing, when two rounds in a row change nothing", () => {
    const { run, handed, saved, marked, ticketComments } = fixing({ check: CHECK_RED });

    const result = run();

    expect(result.status).toBe(1);
    expect(handed()).toHaveLength(2);
    expect(handed()[1]).toContain("check: red test src/stops.test.ts:4");
    expect(saved()).toEqual([]);
    expect(marked()).toContain("811 needs-human");
    expect(ticketComments().at(-1)).toMatch(/^@collod873 /);
    expect(ticketComments().at(-1)).toContain("changed nothing");
  });

  it("resumes the session saved under `.claude/builder` from the builder's last job on this ticket, and saves the one it ends on there alone", () => {
    const { run, hired, keptSession } = fixing({ claude: FIXES, savedSession: "sess-earlier" });

    expect(run().status).toBe(0);
    const [argv] = hired();
    if (argv === undefined) throw new Error("no claude hired");
    expect(argv[argv.indexOf("--resume") + 1]).toBe("sess-earlier");
    expect(keptSession()).toBe(BUILDER_SESSION);
    expect(keptSession("fixer")).toBeUndefined();
  });

  it("hands the model the Why, the failed run's log, the machine logs, the diff and only the machine's drift gaps", () => {
    const { run, handed } = fixing({
      claude: FIXES,
      logged: { "build-811.log": "1 refusals\nthe checks are still red after 3 of 3 rounds handed back\n" },
      failedRun: "review\tRun bin/review\tdrifts from the Why of #811\n",
      onPr: ["a comment nobody needs", { author: "stranger", type: "User", body: "The reviewer read this PR against the Why of #811 and found drift.\n\n- delete the fence\n" }, DRIFT],
    });

    expect(run("811", "555").status).toBe(0);
    const prompt = handed()[0];
    expect(prompt).toContain("never the owner");
    expect(prompt).toContain("the checks are still red after 3 of 3 rounds handed back");
    expect(prompt).toContain("drifts from the Why of #811");
    expect(prompt).toContain('+it("names the behaviour the criterion asks for"');
    expect(prompt).toContain("never resumes its session");
    expect(prompt).not.toContain("a comment nobody needs");
    expect(prompt).not.toContain("delete the fence");
  });

  it("refuses a rewrite that changes one byte of the Why, and writes one that changes only what done looks like, then pushes", () => {
    const { body } = fixing();
    const refused = fixing({ answer: { outcome: "ticket", reason: "the Why reads better this way", body: body.replace("never the owner", "never The owner") } });

    expect(refused.run().status).toBe(1);
    expect(refused.edits()).toEqual([]);
    expect(refused.saved()).toEqual([]);

    const redone = body.replace("The builder clears a red ticket", "The builder clears a ticket red at any stage");
    const written = fixing({ answer: { outcome: "ticket", reason: "Done when named one stage where the Why means every stage", body: redone } });

    expect(written.run().status).toBe(0);
    expect(written.edits()).toEqual([redone]);
    expect(written.ticketComments().at(-1)).toContain("every stage");
    expect(written.saved()).toEqual(["811"]);
  });

  it("rewrites past `## Done when` when a builder corrects the body around it, and posts why (#942)", () => {
    const { body } = fixing();
    const corrected = `${body.replace("The builder clears a red ticket", "The builder clears a ticket red at any stage")}\n## Out of scope\n\n- The post door.\n`;
    const { run, edits, ticketComments, saved } = fixing({ answer: { outcome: "ticket", reason: "the ticket named the shape rules, but the fault it names sits in src/post.ts", body: corrected } });

    expect(run().status).toBe(0);
    expect(edits()).toEqual([corrected]);
    expect(ticketComments().at(-1)).toContain("the fault it names sits in src/post.ts");
    expect(saved()).toEqual(["811"]);
  });

  it("keeps `resolving` with no try when woken on a conflict, since a conflict is not the ticket failing, and marks checking once it pushes", () => {
    const resolving = fixing({ reason: "PR #9811 conflicts with main", claude: FIXES, labels: ["ticket", "resolving"] });

    expect(resolving.run().status).toBe(0);
    expect(resolving.marked()).toEqual(["811 checking"]);
  });

  it("closes the ticket and its PR unbuilt with the reason, calling the owner by name, keeping the branch, and runs no check", () => {
    const reason = "the ticket asks for a stage the ruling has since dropped";
    const { run, closes, ticketComments, labelled, saved, handed } = fixing({ answer: { outcome: "close", reason }, check: "touch ../checked\nexit 1\n" });

    expect(run().status).toBe(0);
    expect(closes()).toEqual([
      ["issue", "close", "811", "--reason", "not planned"],
      ["pr", "close", "ticket/811"],
    ]);
    expect(ticketComments().at(-1)).toMatch(new RegExp(`^@collod873 .*${reason}`));
    expect(labelled(), "leaves its labels to the close handler").toEqual([]);
    expect(saved()).toEqual([]);
    expect(handed()).toHaveLength(1);
  });

  it("splits a ticket too big for one build into follow-up tickets that build themselves, and parks what must wait under `waiting`, where #910 was closed in silence", () => {
    const { body } = fixing();
    const waits = body.replace("The builder clears a red ticket", "The builder turns the flag on once its pieces merge");
    const reason = "it is two changes that build apart";
    const tickets = [
      { title: "Handle the misses in the shape rules", why: "The shape rules refuse a missing read by name.", done: ["Shape reads refuse by name."] },
      { title: "Handle the misses in the post door", why: "The post door refuses a missing read by name.", done: ["Post reads refuse by name."] },
    ];
    const { run, filed, edits, labelled, marked, closes, ticketComments, saved, handed } = fixing({ answer: { outcome: "split", reason, tickets, body: waits }, check: "touch ../checked\nexit 1\n" });

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
    expect(edits()).toEqual([waits]);
    expect(ticketComments().at(-1)).toMatch(new RegExp(`^@collod873 the builder split #811 into #901, #902, which build themselves\\..*${reason}`));
    expect(labelled()).toEqual([]);
    expect(marked()).toEqual(["811 building --try", "811 waiting"]);
    expect(closes()).toEqual([["pr", "close", "ticket/811", "--delete-branch"]]);
    expect(saved()).toEqual([]);
    expect(handed()).toHaveLength(1);
  });

  it("closes a split ticket with nothing left to wait, once its follow-ups are filed", () => {
    const tickets = [{ title: "Handle the misses in the shape rules", why: "The shape rules refuse a missing read by name.", done: ["Shape reads refuse by name."] }];
    const { run, filed, closes, ticketComments } = fixing({ answer: { outcome: "split", reason: "one piece holds all of it", tickets } });

    expect(run().status).toBe(0);
    expect(filed()).toHaveLength(1);
    expect(ticketComments().at(-1)).toMatch(/^@collod873 the builder split #811 into #901, which build themselves, and closed it/);
    expect(closes()).toEqual([
      ["issue", "close", "811", "--reason", "not planned"],
      ["pr", "close", "ticket/811"],
    ]);
  });

  it("files nothing and hands the split back when a follow-up says nothing about what done looks like", () => {
    const piece = { title: "Handle the misses", why: "The rules refuse a missing read by name.", done: [] };
    const unshaped = fixing({ answer: { outcome: "split", reason: "no Done when", tickets: [piece] } });

    expect(unshaped.run().status).toBe(1);
    expect(unshaped.filed()).toEqual([]);
    expect(unshaped.handed()[1]).toContain("Handle the misses: '## Done when' carries 0");
  });

  it("will not split a follow-up again, so a chain of splits stops at one generation", () => {
    const { body } = fixing();
    const followUp = body.replace("The owner, in session:", "Follow-up of #700: its builder split it, since it does not fit one build.\n\n>");
    const piece = { title: "Handle the misses", why: "The rules refuse a missing read by name.", done: ["Reads refuse by name."] };
    const { run, filed, handed } = fixing({ body: followUp, answer: { outcome: "split", reason: "still too big", tickets: [piece] } });

    expect(run().status).toBe(1);
    expect(filed()).toEqual([]);
    expect(handed()[1]).toContain("itself a follow-up, so it is not split again");
  });

  it("merges a machine fix it landed on main into the ticket, tells the owner, and pushes once green", () => {
    const reason = "the reviewer read a renamed export as drift";
    const { run, ticketComments, saved, log } = fixing({ answer: { outcome: "machine", reason }, claude: MOVES_MAIN });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(ticketComments()).toEqual([expect.stringMatching(new RegExp(`^@collod873 .*changed the machine: ${reason}`))]);
    expect(log("--format=%s")).toContain("Land the reviewer fix #811 needed");
    expect(saved()).toEqual(["811"]);
  });

  it("will not take `machine` for an answer when main has not moved", () => {
    const { run, handed, saved, ticketComments } = fixing({ answer: { outcome: "machine", reason: "the reviewer is wrong" } });

    expect(run().status).toBe(1);
    expect(handed()).toHaveLength(2);
    expect(saved()).toEqual([]);
    expect(ticketComments().at(-1)).toContain("main has not moved");
  });

  const CALLER = "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main";
  const FAULT = { title: "Give the machine's check the database a tree's integration step needs", why: "The machine's check runs a tree's integration step with no database, so it is red whatever the code.", done: ["A tree's integration step runs against a database on the machine."] };

  it("files a machine fault found in a foreign tree as a ticket in the machine's repo, and parks its own ticket waiting on it, where Lumaria #828 landed a fix into Lumaria's main (#1143)", () => {
    const reason = "the machine's check has no database";
    const { run, calls, filed, ticketComments, marked, saved, closes, handed } = fixing({ calledFrom: CALLER, answer: { outcome: "machine", reason, tickets: [FAULT] }, claude: FIXES });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter((args) => args[1] === "create").map((args) => args.slice(args.indexOf("--repo"), args.indexOf("--repo") + 2))).toEqual([["--repo", "collod873/claude-workflow"]]);
    expect(filed()).toHaveLength(1);
    expect(filed()[0]).toMatch(/^## Why\n\nFiled by the builder of collod873\/Lumaria#811, which waits on it/);
    expect(filed()[0]).toContain(`> ${FAULT.why}`);
    expect(filed()[0]).toContain(`## Done when\n\n- ${FAULT.done[0]}`);
    expect(ticketComments().at(-1)).toMatch(new RegExp(`^@collod873 the builder of #811 found the machine at fault and filed https://github.com/collod873/claude-workflow/issues/901\\. #811 waits on it.*${reason}`));
    expect(marked()).toEqual(["811 building --try", "811 waiting"]);
    expect(saved()).toEqual([]);
    expect(closes()).toEqual([]);
    expect(handed()).toHaveLength(1);
  });

  it("tells a builder in a foreign tree to file a machine fault here, not to land it on the tree's main (#1143)", () => {
    const { run, handed } = fixing({ calledFrom: CALLER, claude: FIXES });

    expect(run().status).toBe(0);
    expect(handed()[0]).not.toContain("`bin/land`");
    expect(handed()[0]).toContain("- `machine`: the machine is at fault, reviewer included; it lives in collod873/claude-workflow, not this tree, so change nothing here for it: file the fault as `tickets`, and this ticket waits on them.");
  });

  it("hands back a `machine` answer from a foreign tree that files no ticket (#1143)", () => {
    const { run, filed, handed, marked } = fixing({ calledFrom: CALLER, answer: { outcome: "machine", reason: "the check has no database" } });

    expect(run().status).toBe(1);
    expect(filed()).toEqual([]);
    expect(marked()).not.toContain("811 waiting");
    expect(handed()[1]).toContain("files the machine's fault as one ticket or more in `tickets`");
  });

  it("reruns only the red jobs of a Check it left unchanged and green, and never restarts a Build", () => {
    const flake = fixing({ ranAs: "Check" });
    const fixed = fixing({ ranAs: "Check", claude: FIXES });
    const built = fixing({ ranAs: "Build" });

    expect(flake.run("811", "555").status).toBe(0);
    expect(flake.reruns()).toEqual([["run", "rerun", "555", "--failed"]]);
    expect(flake.marked(), "takes back the try a flake was counted").toEqual(["811 building --try", "811 checking --untry"]);
    expect(fixed.run("811", "555").status).toBe(0);
    expect(fixed.marked()).toEqual(["811 building --try", "811 checking"]);
    expect(fixed.reruns()).toEqual([]);
    expect(built.run("811", "555").status).toBe(0);
    expect(built.reruns()).toEqual([]);
    expect(built.saved()).toEqual(["811"]);
  });

  it("reruns a red Check only once, then calls the owner, so an unchanged branch cannot loop through Check", () => {
    const { run, reruns, marked, ticketComments } = fixing({ ranAs: "Check", attempt: 2 });

    expect(run("811", "555").status).toBe(1);
    expect(reruns()).toEqual([]);
    expect(marked()).toContain("811 needs-human");
    expect(ticketComments().at(-1)).toContain("already reran once");
  });

  it("calls the owner when the rerun of its unchanged green Check is refused", () => {
    const { run, marked, ticketComments } = fixing({ ranAs: "Check", rerun: "printf 'HTTP 403: Resource not accessible by integration\\n' >&2\nexit 1" });

    expect(run("811", "555").status).toBe(1);
    expect(marked()).toContain("811 needs-human");
    expect(ticketComments().at(-1)).toContain("HTTP 403");
  });

  it("hands a fresh session the ticket again with the red when resuming its own session fails", () => {
    const resumeFails = 'if printf \'%s\\n\' "$@" | grep -qx -- --resume; then printf \'No conversation found\\n\' >&2; exit 1; fi\n';
    const { run, handed } = fixing({ claude: resumeFails + FIXES_EACH_ROUND, check: FULL_CHECK_RED_ONCE });

    expect(run().status).toBe(0);
    expect(handed().at(-1)).toContain("never the owner");
    expect(handed().at(-1)).toContain("OTHER-TEST-BROKE in src/stops.test.ts");
  });

  it("calls the owner and closes nothing when its own model call fails twice (#862)", () => {
    const { run, closes, ticketComments, marked } = fixing({ claude: "printf 'the model overloaded\\n' >&2\nexit 1\n" });

    expect(run().status).toBe(1);
    expect(closes()).toEqual([]);
    expect(marked()).toContain("811 needs-human");
    expect(ticketComments().at(-1)).toContain("the model overloaded");
  });

  it("hands a refused Save back to the builder as red rather than stopping", () => {
    const { run, handed } = fixing({ claude: FIXES_EACH_ROUND, save: "[ -f ../saved-once ] && exit 0\ntouch ../saved-once\nexit 1\n" });

    expect(run().status).toBe(0);
    expect(handed()).toHaveLength(2);
    expect(handed()[1]).toContain("Save could not push");
  });

  it("is handed the reason the closer woke it as how the ticket failed, instead of reading logs (#957)", () => {
    const reason = "#811 is not done: a check is red on the merge commit\n\n- `test -f built.txt` exited 1 on the merge commit";

    const { result, prompt } = woken(reason);

    expect(result.status, result.stderr).toBe(0);
    expect(prompt).toContain("## How it failed");
    expect(prompt).toContain(reason);
  });

  it("is handed the reason the closer woke it, and a conflict is handed the word to merge main in and resolve it keeping the ticket's Why (#957)", () => {
    const reason = "#811's PR #903 could not be brought up to date with main: GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts.";

    const { result, prompt } = woken(reason);

    expect(result.status, result.stderr).toBe(0);
    expect(prompt).toContain(reason);
    expect(prompt).toMatch(/merge main in/i);
    expect(prompt).toMatch(/resolve (the|it)[^.\n]*conflict/i);
    expect(prompt).toMatch(/keeping[^.\n]*Why/i);
  });
});

describe("the builder builds an App-opened ticket only under an open spec the owner opened (#1022)", () => {
  const SPEC = { state: "open", user: { login: "collod873" }, labels: [{ name: "spec" }] };
  const APP = "collod873-machine[bot]";
  const ticketWhy = (line: string) => `## Why\n\n${line}\n\n## Done when\n\n- The builder builds it.\n`;
  const stopped = (scenario: ReturnType<typeof fixing>) => {
    const result = scenario.run("811");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("#811");
    expect(scenario.handed()).toEqual([]);
    expect(scenario.marked()).toEqual([]);
    return result.stderr;
  };

  it("builds a ticket the App opened under an open spec the owner opened", () => {
    const { run, handed } = fixing({ claude: FIXES, opener: APP, parent: SPEC });

    expect(run("811").status).toBe(0);
    expect(handed()).toHaveLength(1);
  });

  it("stops a ticket the App opened under a spec the App opened, before its builder runs anything", () => {
    expect(stopped(fixing({ claude: FIXES, opener: APP, parent: { ...SPEC, user: { login: APP } } }))).toContain("the owner");
  });

  it("stops a ticket the App opened under a closed spec", () => {
    expect(stopped(fixing({ claude: FIXES, opener: APP, parent: { ...SPEC, state: "closed" } }))).toContain("open");
  });

  it("stops a ticket the App opened under an issue not labelled spec", () => {
    expect(stopped(fixing({ claude: FIXES, opener: APP, parent: { ...SPEC, labels: [{ name: "ticket" }] } }))).toContain("spec");
  });

  it("stops a ticket the App opened under no spec", () => {
    expect(stopped(fixing({ claude: FIXES, opener: APP }))).toContain("spec");
  });

  it("stops a ticket the App opened whose Why only quotes a follow-up line", () => {
    const body = ticketWhy("> Follow-up of #865: its review found this after the builder's one turn.");
    stopped(fixing({ claude: FIXES, opener: APP, body }));
  });

  it("stops a ticket the App opened whose Why has a follow-up line neither the reviewer nor the builder writes", () => {
    stopped(fixing({ claude: FIXES, opener: APP, body: ticketWhy("Follow-up of #865: its notes.") }));
  });

  it("stops a ticket the App opened whose parent cannot be read, saying so rather than no spec", () => {
    const said = stopped(fixing({ claude: FIXES, opener: APP, parent: "unreadable" }));

    expect(said).toContain("could not be read");
    expect(said).not.toContain("no spec");
  });

  it("builds the reviewer's and the builder's follow-ups under no spec, as before", () => {
    const reviewed = fixing({ claude: FIXES, opener: APP, body: ticketWhy("Follow-up of #865: its review found this after its builder's repair.") });
    const split = fixing({ claude: FIXES, opener: APP, body: ticketWhy("Follow-up of #865: its builder split it, since it does not fit one build.") });

    expect(reviewed.run("811").status).toBe(0);
    expect(split.run("811").status).toBe(0);
    expect(reviewed.handed()).toHaveLength(1);
    expect(split.handed()).toHaveLength(1);
  });

  it("builds the owner's own ticket under no spec, as before", () => {
    const { run, handed } = fixing({ claude: FIXES });

    expect(run("811").status).toBe(0);
    expect(handed()).toHaveLength(1);
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

describe("bin/fix reads its ticket, its labels, its PR and their comments before it marks anything, and ends red at a read that fails (#1112)", () => {
  const READS = [
    { read: "its ticket", unreadable: '*"issue view"*', line: "#811 could not be read, so no label changed and no model was hired" },
    { read: "the log directory", gitUnreadable: '*"--git-common-dir"*', line: "the log directory could not be named by git, so no model was hired" },
    { read: "its PR", unreadable: '*"pr view"*"number"*', line: "the PR of #811 could not be read" },
    { read: "its PR's comments", unreadable: '*"issues/9811/comments"*', line: "the comments on PR #9811 could not be read, so nothing is marked" },
    { read: "its ticket's comments", unreadable: '*"issues/811/comments"*', line: "the comments on #811 could not be read, so nothing is marked" },
    { read: "its failed run", unreadable: '*"run view"*"--log-failed"*', line: "the failed steps of run 555 could not be read, so nothing is marked" },
  ];

  it.each(READS)("ends red at unread naming $read, marking, posting and hiring nothing", ({ line, ...reads }) => {
    const unread = fixing({ claude: FIXES, ...reads });

    expect(unread.run()).toMatchObject({ status: 1, stderr: `fix: ${line}\n` });
    untouched(unread);
  });

  it("ends red at unread naming the run it was woken by when that run cannot be read once green, marking it checking for nothing and rerunning nothing", () => {
    const { run, marked, reruns } = fixing({ claude: FIXES, unreadable: '*"run view"*"--json"*' });

    expect(run()).toMatchObject({ status: 1, stderr: "fix: the workflow, head and attempt of run 555 could not be read, so it is not marked checking\n" });
    expect(marked()).toEqual(["811 building --try"]);
    expect(reruns()).toEqual([]);
  });

  it("builds a ticket that has no PR yet, reading none as none", () => {
    const { run, handed, marked } = fixing({ claude: FIXES, onPr: undefined });

    expect(run("811").status).toBe(0);
    expect(handed()).toHaveLength(1);
    expect(marked()).toEqual(["811 building", "811 checking"]);
  });
});

describe("bin/fix opens through the one stage opening (#1117)", () => {
  it("ends green in one line on a ticket marked needs-human, and changes no label and hires no model", () => {
    const stopped = fixing({ claude: FIXES, labels: ["ticket", "needs-human"] });

    expect(stopped.run("811")).toEqual({ status: 0, stdout: "fix: #811 is marked needs-human, so no label changed and no model was hired\n", stderr: "" });
    untouched(stopped);
  });

  it("ends red at modelRun when the owner's hooks cannot be read, leaving the owner to the workflow's call-owner step", () => {
    const { run, marked, handed, ticketComments } = fixing({ claude: FIXES, hooks: "/nowhere/agent-hooks.json" });

    expect(run("811")).toMatchObject({ status: 1, stderr: "fix: #811 ended red, the owner's hooks could not be read from /nowhere/agent-hooks.json\n" });
    expect(marked()).toEqual(["811 building"]);
    expect(handed()).toEqual([]);
    expect(ticketComments()).toEqual([]);
  });

  it("refuses an unadmitted ticket after the needs-human rule, so a stopped ticket stays green", () => {
    const { run, marked } = fixing({ claude: FIXES, opener: "collod873-machine[bot]", labels: ["ticket", "needs-human"] });

    expect(run("811")).toMatchObject({ status: 0, stderr: "" });
    expect(marked()).toEqual([]);
  });
});

describe("the builder builds another repo's checkout from this repo's bin/ (#1134)", () => {
  const READIED = '{ "setup": "touch ../readied", "steps": {} }\n';
  const SEES_READIED = "[ -e ../readied ] && printf 'readied\\n' >>../hired-readied\n";
  const COMMITLINTED = { "commitlint.config.js": "export default { extends: ['@commitlint/config-conventional'] };\n" };

  it("readies the tree with its contract's setup before the hire, and judges it and calls gh from that tree", () => {
    const { run, session, ranIn, saved, marked } = fixing({ contract: READIED, claude: `${SEES_READIED}${FIXES}` });

    const result = run("811");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(session, "..", "hired-readied"), "utf8")).toBe("readied\n");
    expect(ranIn()).toEqual(expect.arrayContaining([`gh ${realpathSync(session)}`, `check ${realpathSync(session)}`, `claude ${realpathSync(session)}`]));
    expect(ranIn().every((line) => line.endsWith(realpathSync(session)))).toBe(true);
    expect(marked()).toEqual(["811 building", "811 checking"]);
    expect(saved()).toEqual(["811"]);
  });

  it("runs the tree's setup, its check and its builder's commands on the Node and package manager the tree pins, and itself and the builder's node launcher on the machine's own Node (#1138)", () => {
    const pinned = { node: "printf 'v20.0.0\\n'\n", pnpm: "printf 'pnpm %s\\n' \"$*\" >>../pinned-ran\n" };
    const sees = (who: string) => `printf '${who} %s %s\\n' "$(node --version)" "$(command -v pnpm >/dev/null && echo pnpm)" >>../pinned-ran\n`;
    const { run, session } = fixing({ contract: '{ "setup": "pnpm install --frozen-lockfile && node --version >>../pinned-ran", "steps": {} }\n', claude: `${sees("builder")}${FIXES}`, check: `${sees("check")}${CHECK_PASSES}`, treePath: pinned, nodeLauncher: true });

    const result = run("811");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(session, "..", "pinned-ran"), "utf8").trim().split("\n")).toEqual(["pnpm install --frozen-lockfile", "v20.0.0", `launcher ${process.version}`, "builder v20.0.0 pnpm", "check v20.0.0 pnpm"]);
  });

  it("calls the owner and hires no one when its contract's setup fails", () => {
    const { run, handed, marked, ticketComments } = fixing({ contract: '{ "setup": "echo no lockfile >&2; exit 3", "steps": {} }\n', claude: FIXES });

    expect(run("811").status).toBe(1);
    expect(handed()).toEqual([]);
    expect(marked()).toEqual(["811 building", "811 needs-human"]);
    expect(ticketComments()).toEqual([expect.stringContaining("its tree's setup failed: no lockfile")]);
  });

  it("writes a build commit the repo's commitlint accepts when the repo carries one", () => {
    const { run, log, handed } = fixing({ onMain: COMMITLINTED, claude: FIXES });

    expect(run("811").status).toBe(0);
    expect(log("-1", "--format=%s")).toBe("feat: build #811 as its builder");
    expect(handed()[0]).toContain("commitlint");
  });

  it("writes a repair commit the repo's commitlint accepts when the repo carries one", () => {
    const { run, log } = fixing({ onMain: COMMITLINTED, claude: FIXES });

    expect(run().status).toBe(0);
    expect(log("-1", "--format=%s")).toBe("fix: repair #811 as its builder");
  });

  it("keeps this repo's messages, and tells its builder nothing of commitlint, when the repo carries none", () => {
    const { run, log, handed } = fixing({ claude: FIXES });

    expect(run("811").status).toBe(0);
    expect(log("-1", "--format=%s")).toBe("Build #811 as its builder");
    expect(handed()[0]).not.toContain("commitlint");
  });
});

describe("the builder borrows nothing from the reviewer, so a change to one leaves the other alone (#1121)", () => {
  const SRC = import.meta.dirname;
  const machine = () => readdirSync(SRC).filter((file) => file.endsWith(".ts") && !/\.(test|part)\.ts$/.test(file) && file !== "scenarios.ts");
  const MOVED = ["DIFF_CAP", "TICKET_CAP", "LIST_CAP", "NO_EM_DASH", "handedDiff", "FOLLOW_UP_OF", "BUILDER_SPLIT", "REVIEWED_FROM", "SPLIT_FROM", "followUpBody", "earlierDrift", "repairOf", "TICKET_BRANCH"];

  it("imports nothing from the reviewer", () => {
    expect(readFileSync(join(SRC, "builder.ts"), "utf8")).not.toMatch(/from "\.\/reviewer\.ts"/);
  });

  it("leaves each helper it borrowed one home, in the brief part or the GitHub part, and no copy or re-export beside it", () => {
    const homes = MOVED.map((name) => {
      const declared = new RegExp(`export (?:const|function) ${name}\\b|export \\{[^}]*\\b${name}\\b`);
      return `${name} ${machine().filter((file) => declared.test(readFileSync(join(SRC, file), "utf8")) && !(name === "DIFF_CAP" && file === "wave.ts")).join(" ")}`;
    });

    expect(homes).toEqual(MOVED.map((name) => `${name} ${["DIFF_CAP", "TICKET_CAP", "LIST_CAP", "NO_EM_DASH", "handedDiff"].includes(name) ? "brief.ts" : "post.ts"}`));
  });
});
