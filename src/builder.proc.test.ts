import { describe, expect, it } from "vitest";
import { BUILDER_SESSION, FULL_CHECK_RED_ONCE, fixing } from "./builder.part.ts";

const DRIFT = "The reviewer read this PR against the Why of #811 and found drift.\n\n- src/builder.ts never resumes its session\n";
const FIXES = "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n";
const RED_FOUR_TIMES = ["n=$(cat ../reds 2>/dev/null || echo 0)", "[ \"$n\" -ge 4 ] && exit 0", "echo $((n + 1)) >../reds", "printf 'bin/check: FAILED test src/stops.test.ts\\n'", "exit 1", ""].join("\n");
const FIXES_EACH_ROUND = "printf 'export const shaped = %s;\\n' \"$((CALL + 1))\" >src/ticket-shape.ts\n";
const MOVES_MAIN = 'git update-ref refs/remotes/origin/main "$(git commit-tree -p refs/remotes/origin/main -m "Land the reviewer fix #811 needed" "$(git rev-parse "refs/remotes/origin/main^{tree}")")"\n';
const FILED_IN_SESSION = "## Why\n\nThe owner: \"read what I said\".\n\nSession: `ca2517b0-5e2d-46e7-a894-7fc3a4b978b2`\n\n## Done when\n\n- The builder reads it.\n";
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

  it("opens a build with the whole of bin/check as it stands in the tree it builds in (#990)", () => {
    const check = "run typecheck tsc --noEmit\nrun gate-only-this-tree node src/gate.ts\nexit 0\n";
    const { run, handed } = fixing({ claude: FIXES, check });

    expect(run("811").status).toBe(0);
    expect(handed()[0]).toContain(check.trim());
  });

  it("hands a builder woken on a red no copy of bin/check (#990)", () => {
    const check = "run gate-only-this-tree node src/gate.ts\nexit 0\n";
    const { run, handed } = fixing({ reason: "the Check went red", claude: FIXES, check });

    expect(run("811").status).toBe(0);
    expect(handed()[0]).not.toContain("gate-only-this-tree");
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

  it("hands a red bin/check back to the same session, then commits, pushes and marks the ticket checking", () => {
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
    const { run, handed, saved, marked, ticketComments } = fixing({ check: "printf 'bin/check: FAILED test\\n'\nexit 1\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(handed()).toHaveLength(2);
    expect(handed()[1]).toContain("bin/check: FAILED test");
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
