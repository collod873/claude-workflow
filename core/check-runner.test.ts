import { describe, expect, it } from "vitest";
import { passingCriteria, runCheck, type Shell } from "./check-runner.ts";
import { LINE_LIMIT } from "./post.ts";

const VITEST = "npx vitest run --config core/vitest.config.ts check-runner";
const GREP = "grep -q runCheck core/bin/file-issue";
const RAN_ONE = " Test Files  1 passed (1)\n      Tests  1 passed (1)\n";
const RAN_NONE = " Test Files  1 skipped (1)\n      Tests  3 skipped (3)\n";
const NO_FILES = "No test files found, exiting with code 1\n\nfilter: check-runner\n";

function says(output: string, status: number): Shell {
  return () => ({ status, stdout: output, stderr: "" });
}

function ticket(...commands: string[]): string {
  return [
    "## Acceptance criteria",
    "",
    ...commands.map((command) => `- [ ] it does the thing - check: \`${command}\``),
    "",
    "## Files claimed",
    "",
  ].join("\n");
}

describe("core/check-runner.ts passes a check only when it ran and measured something (#662)", () => {
  it("fails a check that exits non-zero and passes one that exits zero", () => {
    expect(runCheck(GREP, ".", says("", 1))).toMatchObject({ passed: false, why: "exited 1" });
    expect(runCheck(GREP, ".", says("", 0))).toMatchObject({ passed: true, why: "" });
  });

  it("fails a vitest check that ran zero tests, whatever its exit code", () => {
    expect(runCheck(VITEST, ".", says(RAN_NONE, 0))).toMatchObject({ passed: false, why: "ran no tests" });
    expect(runCheck(VITEST, ".", says(NO_FILES, 1))).toMatchObject({ passed: false, why: "ran no tests" });
  });

  it("passes a vitest check that ran one test, and fails one whose tests ran and failed", () => {
    expect(runCheck(VITEST, ".", says(RAN_ONE, 0))).toMatchObject({ passed: true, output: RAN_ONE });
    expect(runCheck(VITEST, ".", says("      Tests  1 failed | 2 passed (3)\n", 1))).toMatchObject({ passed: false, why: "exited 1" });
  });

  it("hands back what the check said on either stream", () => {
    expect(runCheck(GREP, ".", () => ({ status: 2, stdout: "said\n", stderr: "wrote\n" })).output).toBe("said\nwrote\n");
  });

  it("names each criterion whose check already passes and leaves the red ones alone", () => {
    const green = "npx vitest run --config core/vitest.config.ts done";
    const red = "npx vitest run --config core/vitest.config.ts todo";
    const run: Shell = (command) => (command === green ? { status: 0, stdout: RAN_ONE, stderr: "" } : { status: 1, stdout: RAN_NONE, stderr: "" });

    expect(passingCriteria(ticket(red, green), ".", run)).toEqual([`criterion 2 already passes, so it measures nothing: \`${green}\``]);
    expect(passingCriteria(ticket(red), ".", run)).toEqual([]);
    expect(passingCriteria("## Acceptance criteria\n\n- [ ] no marker at all\n", ".", run)).toEqual([]);
  });

  it("keeps a long command inside the line it refuses with", () => {
    const long = `npx vitest run --config core/vitest.config.ts ${"name-".repeat(40)}`;
    const [refusal] = passingCriteria(ticket(long), ".", says(RAN_ONE, 0));

    expect(refusal.length).toBeLessThan(LINE_LIMIT);
    expect(refusal).toContain("…");
  });
});
