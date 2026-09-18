import { describe, expect, it } from "vitest";
import { type Shell } from "./check-runner.ts";
import { DENIED } from "./deny-list.ts";
import { authoring, wellFormedTicket } from "./scenarios.ts";
import { uncovered } from "./test-author.ts";

const ran = (stdout: string, status: number): Shell => () => ({ status, stdout, stderr: "" });
const RED = ran("      Tests  1 failed (1)\n", 1);
const GREEN = ran("      Tests  1 passed (1)\n", 0);
const NO_TESTS = ran("No test files found, exiting with code 1\n", 1);

describe("the test author writes one failing test per criterion, or ends red (#663)", () => {
  it("counts a criterion covered only when its check ends red on a test that ran", () => {
    expect(uncovered(wellFormedTicket, ".", RED)).toEqual([]);
    expect(uncovered(wellFormedTicket, ".", GREEN)).toEqual([expect.stringContaining("criterion 1 has no failing test")]);
    expect(uncovered(wellFormedTicket, ".", NO_TESTS)).toEqual([expect.stringContaining("ran no tests")]);
  });

  it("commits one failing test per criterion on the ticket branch, under the shared deny list", () => {
    const { run, committed, handedOn } = authoring();

    const result = run();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([expect.stringContaining("#723")]);
    expect(committed()).toEqual(["core/ticket-shape.test.ts"]);
    expect(handedOn()).toContain(DENIED.join(","));
  });

  it("ends red naming the criterion whose check still passes, and writes nothing", () => {
    const { run, committed } = authoring({ npx: "printf '      Tests  1 passed (1)\\n'\nexit 0\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("criterion 1 has no failing test");
    expect(committed()).toEqual([]);
  });

  it("ends red naming the criterion no test ran for, and writes nothing", () => {
    const { run, committed } = authoring({ npx: "printf 'No test files found\\n'\nexit 1\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ran no tests");
    expect(committed()).toEqual([]);
  });

  it("ends red when the model wrote no test at all, and writes nothing", () => {
    const { run, committed } = authoring({ claude: "true\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("wrote no test");
    expect(committed()).toEqual([]);
  });

  it("spends no model on a ticket GitHub will not hand over", () => {
    const { run, handedOn } = authoring({ reads: false });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#723 ended red");
    expect(handedOn()).toBe("");
  });
});
