import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { errorMessage, reason } from "./reason";

function caughtExecFailure(script: string): unknown {
  try {
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
    expect(reason(new Error("no such file: CONTEXT.md"))).toBe("no such file: CONTEXT.md");
    expect(reason("not an Error at all")).toBe("not an Error at all");
  });

  it("keeps the tail rather than the head when a child floods stdout", () => {
    const err = caughtExecFailure('printf "x%.0s" $(seq 1 9000); echo "THE LAST LINE"; exit 1');
    const report = reason(err);

    expect(report).toContain("THE LAST LINE");
    expect(report.length).toBeLessThan(9000);
  });
});

describe("errorMessage", () => {
  it("leaves the child's stdout out, so a classifier matches on the smallest haystack", () => {
    const err = caughtExecFailure(`a='! [rejec'; b='ted] a hook quoting git'; echo "$a$b"; exit 1`);

    expect(reason(err)).toContain("! [rejected]");
    expect(errorMessage(err)).not.toContain("! [rejected]");
  });

  it("narrows the same way for anything that is not a child-process failure", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(42)).toBe("42");
  });
});
