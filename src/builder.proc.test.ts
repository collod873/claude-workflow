import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DENIED } from "./deny-list.ts";
import { building, heard, plant, scratch, writesOutsideRepo } from "./scenarios.ts";

const BUILDS = "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n";
const GREEN_ONCE_BUILT = [
  "if grep -q 'shaped = 2' src/ticket-shape.ts; then printf '      Tests  1 passed (1)\\n'; exit 0; fi",
  "printf ' FAIL  src/ticket-shape.test.ts > names the behaviour\\n      Tests  1 failed (1)\\n'",
  "exit 1",
  "",
].join("\n");

const allowed = (argv: string) => argv.split("\n")[argv.split("\n").indexOf("--allowedTools") + 1].split(",");

describe("the builder builds against the brief, with one resumed repair round (#725)", () => {
  it("resumes its own session for exactly one repair round, handed the check's output tail capped at 8 KB", () => {
    const head = "HEAD-OF-CHECK-OUTPUT";
    const tail = "TAIL-OF-CHECK-OUTPUT";
    const npx = [
      `printf '%s' '${head}'`,
      "printf 'x%.0s' {1..50000}",
      `printf '%s\\n' '${tail}'`,
      "printf '      Tests  1 failed (1)\\n'",
      "exit 1",
      "",
    ].join("\n");
    const { run, calls, argv, stdin, sessionId } = building({ npx });

    const result = run();

    expect(heard(result).status).toBe(1);
    expect(calls()).toBe(2);
    expect(argv(2)).toContain(`--resume\n${sessionId}`);
    expect(stdin(2)).toContain(tail);
    expect(stdin(2)).not.toContain(head);
    expect((stdin(2).match(/x/g) ?? []).length).toBeLessThan(50000);
  });

  it("hands the model a permission mode that lets it write a path under .claude/, so a ticket claiming one is built instead of refused", () => {
    const { run, argv } = building();

    run();

    expect(argv(1)).toContain("--permission-mode\nbypassPermissions");
  });

  it("ends red naming the path when the model writes a file outside the repo", () => {
    const outside = join(scratch("outside-"), "secret.txt");
    const { run } = building({ claude: writesOutsideRepo(outside) });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(outside);
  });

  it("refuses an edit to the author's test files, beside the shared deny list, and runs only its check commands", () => {
    const { run, argv } = building();

    const result = run();

    expect(heard(result).status).toBe(1);
    expect(argv(1)).toContain(DENIED.join(","));
    expect(argv(1)).toContain("Edit(src/ticket-shape.test.ts)");
    expect(allowed(argv(1))).toEqual(expect.arrayContaining(["Bash(npx vitest run --config vitest.config.ts ticket-shape)", "Bash(bin/check static)"]));
    expect(allowed(argv(1))).not.toContain("Bash");
  });

  it("commits what it built on the ticket branch and ends green on one call when the checks pass", () => {
    const { run, calls, committed, dirty } = building({ claude: BUILDS, npx: GREEN_ONCE_BUILT });

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining("#724 green")] });
    expect(calls()).toBe(1);
    expect(committed()).toEqual([expect.stringContaining("#724"), "src/ticket-shape.ts"]);
    expect(dirty()).toBe("");
  });

  it("commits a build still red after the repair round, so the save step has it to push", () => {
    const { run, calls, committed } = building({ claude: BUILDS });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("still red after the repair round");
    expect(calls()).toBe(2);
    expect(committed()).toEqual([expect.stringContaining("#724"), "src/ticket-shape.ts"]);
  });

  it("spends no model on a branch that carries no test from the author", () => {
    const { run, calls } = building({ tests: {} });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no failing test");
    expect(calls()).toBe(0);
  });

  it("spends no model on a tree holding work nobody committed", () => {
    const { run, calls, session } = building();
    plant(session, "left-behind.txt", "work nobody committed\n");

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("uncommitted");
    expect(calls()).toBe(0);
  });
});
