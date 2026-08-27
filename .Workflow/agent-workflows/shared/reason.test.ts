import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { errorMessage, reason } from "./reason";

/**
 * The narrowing every failure report in this estate runs through, and the split between
 * *reporting* a failure and *matching* on one.
 *
 * The stdout half exists because of a real silence: the shape-accept lane's push was refused by
 * this repo's own `pre-push` hook, and `bin/gauntlet` prints which check failed to **stdout**
 * while `execFileSync` only folds **stderr** into the `Error`'s message. The report that reached
 * the owner was `error: failed to push some refs` and nothing else.
 */

/** A caught `execFileSync` failure, thrown for real rather than hand-shaped — the fields this file asserts on are Node's, not ours. */
function caughtExecFailure(script: string): unknown {
  try {
    // `stderr` piped rather than left to Node's default, which is to inherit it: without this the
    // children below print their fixture text into the suite's own output, where it reads like a
    // failing test rather than like the thing a passing test just proved.
    execFileSync("bash", ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    throw new Error("expected the command to fail");
  } catch (err) {
    return err;
  }
}

describe("reason", () => {
  it("carries the stdout a failing child wrote, not just the stderr in its message", () => {
    const err = caughtExecFailure('echo "--- corpus ---"; echo "+ adrs: 0099-a-ruling.md"; exit 1');

    expect(reason(err)).toContain("--- corpus ---");
    expect(reason(err)).toContain("+ adrs: 0099-a-ruling.md");
  });

  it("still carries the message, which is where the child's stderr already was", () => {
    const err = caughtExecFailure('echo "the findings"; echo "the diagnosis" >&2; exit 1');

    expect(reason(err)).toContain("the diagnosis");
    expect(reason(err)).toContain("the findings");
  });

  it("reads an ordinary Error exactly as it did before", () => {
    // Every test fake in this estate throws one of these. If the stdout half changed how a plain
    // Error reads, it would have quietly rewritten the expected output of unrelated suites.
    expect(reason(new Error("no such file: CONTEXT.md"))).toBe("no such file: CONTEXT.md");
    expect(reason("not an Error at all")).toBe("not an Error at all");
  });

  it("keeps the tail rather than the head when a child floods stdout", () => {
    // These strings reach GitHub issue comments, which are refused outright past 65536 characters.
    // A check runner prints its findings last, so the end is the half worth keeping.
    const err = caughtExecFailure('printf "x%.0s" $(seq 1 9000); echo "THE LAST LINE"; exit 1');
    const report = reason(err);

    expect(report).toContain("THE LAST LINE");
    expect(report.length).toBeLessThan(9000);
  });
});

describe("errorMessage", () => {
  it("leaves the child's stdout out, so a classifier matches on the smallest haystack", () => {
    // `notes-sync`'s `isRejection` is the caller this exists for: it tells a retryable
    // `! [rejected]` race apart from failures that must surface. Git writes that line to stderr,
    // so a hook printing it to stdout is not the race and must not be read as one.
    // Assembled inside the child rather than written as one literal, because `execFileSync` puts
    // the command line itself at the front of the message — a script with the marker spelled out
    // would put it in the message by that route and the assertion would prove nothing.
    const err = caughtExecFailure(`a='! [rejec'; b='ted] a hook quoting git'; echo "$a$b"; exit 1`);

    expect(reason(err)).toContain("! [rejected]");
    expect(errorMessage(err)).not.toContain("! [rejected]");
  });

  it("narrows the same way for anything that is not a child-process failure", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(42)).toBe("42");
  });
});
