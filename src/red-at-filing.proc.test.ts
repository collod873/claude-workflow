import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filing, wellFormedTicket } from "./scenarios.ts";

const URL = "https://github.com/collod873/claude-workflow/issues/679";
const RECORDS = `printf '%s\\n' ${URL}\n`;
const PASSES = "printf '      Tests  1 passed (1)\\n'\nexit 0\n";
const RED = "printf '      Tests  1 failed (1)\\n'\nexit 1\n";
const RAN_NOTHING = "printf '      Tests  3 skipped (3)\\n'\nexit 0\n";

function reachedGh(repo: string): boolean {
  return existsSync(join(repo, "gh-argv"));
}

describe("bin/file-issue files only a ticket whose every check is red (#662)", () => {
  it("refuses a ticket whose check already passes, names that criterion, and files nothing", () => {
    const { repo, run } = filing({ gh: `touch "$PWD/gh-argv"\n${RECORDS}`, body: wellFormedTicket, npx: PASSES });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^criterion 1 already passes, so it measures nothing: `npx vitest run .*ticket-shape`\n$/);
    expect(reachedGh(repo)).toBe(false);
  });

  it("files a ticket whose check is red", () => {
    const { repo, run } = filing({ gh: `touch "$PWD/gh-argv"\n${RECORDS}`, body: wellFormedTicket, npx: RED });

    const result = run();

    expect(result).toMatchObject({ status: 0, stdout: `${URL}\n`, stderr: "" });
    expect(reachedGh(repo)).toBe(true);
  });

  it("files a ticket whose check exits zero having run no tests, because that check measured nothing", () => {
    const { repo, run } = filing({ gh: `touch "$PWD/gh-argv"\n${RECORDS}`, body: wellFormedTicket, npx: RAN_NOTHING });

    expect(run().status).toBe(0);
    expect(reachedGh(repo)).toBe(true);
  });
});
