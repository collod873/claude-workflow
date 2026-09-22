import { describe, expect, it } from "vitest";
import { DENIED } from "./deny-list.ts";
import { building, heard } from "./scenarios.ts";

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

    expect(heard(result).status).toBe(0);
    expect(calls()).toBe(2);
    expect(argv(2)).toContain(`--resume\n${sessionId}`);
    expect(stdin(2)).toContain(tail);
    expect(stdin(2)).not.toContain(head);
    expect((stdin(2).match(/x/g) ?? []).length).toBeLessThan(50000);
  });

  it("refuses an edit to the author's test files, beside the shared deny list", () => {
    const { run, argv } = building();

    const result = run();

    expect(heard(result).status).toBe(0);
    expect(argv(1)).toContain(DENIED.join(","));
    expect(argv(1)).toContain("Edit(src/ticket-shape.test.ts)");
  });
});
