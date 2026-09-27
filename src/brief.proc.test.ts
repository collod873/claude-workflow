import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parts } from "./parts.ts";
import { briefing, heard } from "./scenarios.ts";

const AUTHORED = 'import { it } from "vitest";\nit("refuses a misshapen body", () => {});\n';
const REPO = resolve(import.meta.dirname, "..");

describe("bin/brief writes the brief a stage is handed (#539)", () => {
  it("says one line naming the brief it wrote and its size", () => {
    const { run, written } = briefing();

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringMatching(/#722 is \d+ bytes at .*brief-722\.md$/)] });
    expect(written()).toContain("### src/ticket-shape.ts");
  });

  it("carries the test the author wrote on the ticket branch", () => {
    const { run, written } = briefing({ tests: { "src/ticket-shape.test.ts": AUTHORED } });

    expect(run().status).toBe(0);
    expect(written()).toContain("### src/ticket-shape.test.ts");
    expect(written()).toContain('1  import { it } from "vitest";');
  });

  it("refuses a claim over the cap and leaves the refusal where its line says", () => {
    const { run, written } = briefing({ claimed: { "src/ticket-shape.ts": "export const filler = 1;\n".repeat(9000) } });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("over 204800");
    expect(written()).toContain("bytes, over 204800");
  });

  it("refuses a ticket GitHub will not hand over", () => {
    const { run } = briefing({ reads: false });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#722 refused");
  });
});

describe("the machine keeps no brief command (#946)", () => {
  it("keeps no brief command", () => {
    expect(parts.map((part) => part.name)).not.toContain("bin/brief");
    expect(existsSync(join(REPO, "bin", "brief"))).toBe(false);
    expect(readFileSync(join(REPO, "src", "brief.ts"), "utf8")).not.toContain("import.meta.main");
  });
});
