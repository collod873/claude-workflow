import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Shell } from "./check-runner.ts";
import { DENIED } from "./deny-list.ts";
import { authoring, heard, plant, scratch, wellFormedTicket, writesOutsideRepo } from "./scenarios.ts";
import { handedOn as prompted, uncovered } from "./test-author.ts";

const ran = (stdout: string, status: number): Shell => () => ({ status, stdout, stderr: "" });
const RED = ran("      Tests  1 failed (1)\n", 1);
const GREEN = ran("      Tests  1 passed (1)\n", 0);
const NO_TESTS = ran("No test files found, exiting with code 1\n", 1);

const claimingBuilder = wellFormedTicket.replace("- src/ticket-shape.ts", "- src/builder.ts");
const unimported = (cwd: string, module: string): Shell =>
  ran(
    [
      " FAIL  src/builder.proc.test.ts [ src/builder.proc.test.ts ]",
      `Error: Cannot find module './${module}' imported from ${join(cwd, "src", "builder.proc.test.ts")}`,
      "",
      " Test Files  1 failed (1)",
      "      Tests  no tests",
      "",
    ].join("\n"),
    1,
  );

const PROTOTYPED = [
  'printf \'import { it } from "vitest";\\nit("names the behaviour the criterion asks for", () => {});\\n\' >src/ticket-shape.test.ts',
  "printf 'export const built = 1;\\n' >src/prototype.ts",
  "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts",
  "",
].join("\n");
const WROTE_A_FIXTURE = [
  'printf \'import { it } from "vitest";\\nit("names the behaviour the criterion asks for", () => {});\\n\' >src/ticket-shape.test.ts',
  "printf 'export const fixture = 1;\\n' >src/scenarios.ts",
].join("\n");
const WROTE_A_SANITY_TEST = [
  'printf \'import { it } from "vitest";\\nit("names the behaviour the criterion asks for", () => {});\\n\' >src/ticket-shape.test.ts',
  ": >src/_sanity.test.ts",
].join("\n");
const GREEN_WITH_PROTOTYPE = [
  "if [ -e src/prototype.ts ]; then printf '      Tests  1 passed (1)\\n'; exit 0; fi",
  "printf ' FAIL  src/ticket-shape.test.ts > names the behaviour\\n      Tests  1 failed (1)\\n'",
  "exit 1",
  "",
].join("\n");

describe("the test author writes one failing test per criterion, or ends red (#663)", () => {
  it("counts a criterion covered only when its check ends red on a test that ran", () => {
    expect(uncovered(wellFormedTicket, ".", RED)).toEqual([]);
    expect(uncovered(wellFormedTicket, ".", GREEN)).toEqual([expect.stringContaining("criterion 1 has no failing test")]);
    expect(uncovered(wellFormedTicket, ".", NO_TESTS)).toEqual([expect.stringContaining("ran no tests")]);
  });

  it("counts a check red when its test imports a claimed file not written yet", () => {
    const cwd = scratch("unwritten-");
    const written = scratch("written-");
    plant(written, "src/builder.ts", "export const built = 1;\n");

    expect(uncovered(claimingBuilder, cwd, unimported(cwd, "builder.ts"))).toEqual([]);
    expect(uncovered(claimingBuilder, cwd, unimported(cwd, "unclaimed.ts"))).toEqual([expect.stringContaining("ran no tests")]);
    expect(uncovered(claimingBuilder, written, unimported(written, "builder.ts"))).toEqual([expect.stringContaining("ran no tests")]);
  });

  it("sets aside what the model wrote outside test files before any check runs, and commits only the tests it wrote", () => {
    const { session, run, committed } = authoring({ claude: PROTOTYPED, npx: GREEN_WITH_PROTOTYPE });
    plant(session, "notes.txt", "the owner's own work in progress\n");
    plant(session, "src/unfinished.test.ts", "the owner's own test in progress\n");
    const setAside = join(session, ".git", "machine-logs", "test-author-723-set-aside");

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining("set aside 2 files the checks did not judge")] });
    expect(committed()).toEqual(["src/ticket-shape.test.ts"]);
    expect(existsSync(join(session, "src", "prototype.ts"))).toBe(false);
    expect(readFileSync(join(session, "src", "ticket-shape.ts"), "utf8")).toBe("export const shaped = 1;\n");
    expect(readFileSync(join(session, "notes.txt"), "utf8")).toBe("the owner's own work in progress\n");
    expect(readdirSync(join(setAside, "src")).sort()).toEqual(["prototype.ts", "ticket-shape.ts"]);
  });

  it("commits one failing test per criterion on the ticket branch, under the shared deny list", () => {
    const { run, committed, handedOn } = authoring();

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining("#723")] });
    expect(committed()).toEqual(["src/ticket-shape.test.ts"]);
    expect(handedOn()).toContain(DENIED.join(","));
  });

  it("hands the test author a permission mode that lets it write a path under .claude/, so a ticket claiming one is authored instead of refused", () => {
    const { run, handedOn } = authoring();

    run();

    expect(handedOn()).toContain("--permission-mode\nbypassPermissions");
  });

  it("ends red naming the path when the model writes a file outside the repo", () => {
    const outside = join(scratch("outside-"), "secret.txt");
    const { run } = authoring({ claude: writesOutsideRepo(outside) });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(outside);
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

  it("ends red saying the author wrote nothing, not naming a criterion whose check ran no tests", () => {
    const { run, committed } = authoring({ claude: "true\n", npx: "printf 'No test files found, exiting with code 1\\n'\nexit 1\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the author wrote nothing");
    expect(result.stderr).not.toContain("ran no tests");
    expect(committed()).toEqual([]);
  });

  it("lets the model run bin/check static, and names the gates it holds", () => {
    const { run, handedOn } = authoring();

    run();

    expect(handedOn()).toContain("Bash(bin/check static)");
    expect(prompted("", [])).toMatch(/`bin\/check static`.*comments.*em dash.*src\/scenarios\.ts/s);
  });

  it("keeps the shared fixtures it adds and commits them with its tests", () => {
    const { run, committed } = authoring({ claude: `${WROTE_A_FIXTURE}\n` });

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.not.stringContaining("set aside")] });
    expect(committed()).toEqual(["src/scenarios.ts", "src/ticket-shape.test.ts"]);
  });

  it("sets aside a test file the checks did not run, and commits only the tests they judged", () => {
    const { session, run, committed } = authoring({ claude: `${WROTE_A_SANITY_TEST}\n` });

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining("set aside 1 files")] });
    expect(committed()).toEqual(["src/ticket-shape.test.ts"]);
    expect(existsSync(join(session, "src", "_sanity.test.ts"))).toBe(false);
  });

  it("tells the model a prototype proves nothing and a claimed file not written yet already counts as red", () => {
    expect(prompted("", [])).toMatch(/prototype proves nothing.*claimed file not written yet already counts as red/s);
  });

  it("lets the model run the static gates under either spelling of the path", () => {
    const { run, handedOn } = authoring();

    run();

    expect(handedOn()).toContain("Bash(bin/check static)");
    expect(handedOn()).toContain("Bash(./bin/check static)");
  });

  it("spends no model on a ticket GitHub will not hand over", () => {
    const { run, handedOn } = authoring({ reads: false });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#723 ended red");
    expect(handedOn()).toBe("");
  });
});
