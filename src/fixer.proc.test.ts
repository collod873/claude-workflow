import { describe, expect, it } from "vitest";
import { FIXER_SESSION, FULL_CHECK_RED_ONCE, fixing } from "./scenarios.ts";

const DRIFT = "The reviewer read this PR against the Why of #811 and found drift.\n\n- src/fixer.ts never resumes its session\n";
const FIXES = "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n";
const RED_FOUR_TIMES = ["n=$(cat ../reds 2>/dev/null || echo 0)", "[ \"$n\" -ge 4 ] && exit 0", "echo $((n + 1)) >../reds", "printf 'bin/check: FAILED test src/stops.test.ts\\n'", "exit 1", ""].join("\n");
const FIXES_EACH_ROUND = "printf 'export const shaped = %s;\\n' \"$((CALL + 1))\" >src/ticket-shape.ts\n";
const MOVES_MAIN = 'git update-ref refs/remotes/origin/main "$(git commit-tree -p refs/remotes/origin/main -m "Land the reviewer fix #811 needed" "$(git rev-parse "refs/remotes/origin/main^{tree}")")"\n';

describe("the fixer owns a red ticket until it merges (#898)", () => {
  it("starts on a tree a red stage left dirty, and commits what is there with its fix, where #894 refused before any model", () => {
    const { run, handed, saved, log } = fixing({ leftover: { "src/fixer-turn.test.ts": "import { it } from \"vitest\";\n" }, claude: FIXES });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(1);
    expect(log("-1", "--name-only", "--format=%s").split("\n").filter((line) => line !== "")).toEqual(["Repair #811 as its fixer", "src/fixer-turn.test.ts", "src/ticket-shape.ts"]);
    expect(saved()).toEqual(["811"]);
  });

  it("runs on Opus with no fence, the owner's hooks its only guard", () => {
    const { run, hired } = fixing({ claude: FIXES });

    expect(run().status).toBe(0);
    const argv = hired()[0];
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
    expect(hired()[1]).toContain(FIXER_SESSION);
    expect(saved()).toEqual(["811"]);
    expect(marked()).toEqual(["811 fixing", "811 3-checking"]);
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

  it("resumes the session saved from the fixer's last job on this ticket, and saves the one it ends on", () => {
    const { run, hired, keptSession } = fixing({ claude: FIXES, savedSession: "sess-earlier" });

    expect(run().status).toBe(0);
    const argv = hired()[0];
    expect(argv[argv.indexOf("--resume") + 1]).toBe("sess-earlier");
    expect(keptSession()).toBe(FIXER_SESSION);
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

  it("refuses a rewrite that changes one byte of the Why, and writes one that changes only the criteria, then pushes", () => {
    const { body } = fixing();
    const refused = fixing({ answer: { outcome: "ticket", reason: "the Why reads better this way", body: body.replace("never the owner", "never The owner") } });

    expect(refused.run().status).toBe(1);
    expect(refused.edits()).toEqual([]);
    expect(refused.saved()).toEqual([]);

    const recriteria = body.replace("The fixer clears a red ticket", "The fixer clears a ticket red at any stage");
    const written = fixing({ answer: { outcome: "ticket", reason: "the criterion named one stage where the Why means every stage", body: recriteria } });

    expect(written.run().status).toBe(0);
    expect(written.edits()).toEqual([recriteria]);
    expect(written.ticketComments().at(-1)).toContain("every stage");
    expect(written.saved()).toEqual(["811"]);
  });

  it("closes the ticket and its PR unbuilt with the reason, keeping the branch, and runs no check", () => {
    const reason = "the ticket asks for a stage the ruling has since dropped";
    const { run, closes, ticketComments, saved, handed } = fixing({ answer: { outcome: "close", reason }, check: "touch ../checked\nexit 1\n" });

    expect(run().status).toBe(0);
    expect(closes()).toEqual([
      ["issue", "close", "811", "--reason", "not planned"],
      ["pr", "close", "ticket/811"],
    ]);
    expect(ticketComments().at(-1)).toContain(reason);
    expect(saved()).toEqual([]);
    expect(handed()).toHaveLength(1);
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
    expect(flake.marked()).toEqual(["811 fixing", "811 3-checking"]);
    expect(fixed.run("811", "555").status).toBe(0);
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

  it("hands a refused Save back to the fixer as red rather than stopping", () => {
    const { run, handed } = fixing({ claude: FIXES_EACH_ROUND, save: "[ -f ../saved-once ] && exit 0\ntouch ../saved-once\nexit 1\n" });

    expect(run().status).toBe(0);
    expect(handed()).toHaveLength(2);
    expect(handed()[1]).toContain("Save could not push");
  });
});
