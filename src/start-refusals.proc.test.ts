import { describe, expect, it } from "vitest";
import { DELETED_CLAIM_TICKET, heard, MISSING_CONFIG_TICKET, misshapenTicket, RENAMED_BESIDE_WORDS_TICKET, RENAMED_CLAIM_TICKET, renamedAndDeletedHistory, starting } from "./scenarios.ts";

const CHECK_PASSES = "printf '      Tests  1 passed (1)\\n'\nexit 0\n";

describe("bin/start refuses a build before any model runs (#662)", () => {
  it("refuses a misshapen ticket and spends no model", () => {
    const { run, spentModel } = starting({ body: misshapenTicket });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("'## Acceptance criteria' carries 4 '- [ ]' items");
    expect(spentModel()).toBe(false);
  });

  it("refuses a tree behind origin/main and spends no model", () => {
    const { run, spentModel } = starting({ tree: "behind" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("1 commit behind origin/main");
    expect(spentModel()).toBe(false);
  });

  it("refuses when origin/main cannot be fetched, rather than judge freshness against a stale copy, and spends no model", () => {
    const { run, spentModel } = starting({ tree: "unfetchable" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("origin/main could not be fetched");
    expect(spentModel()).toBe(false);
  });

  it("refuses a tree off main and spends no model", () => {
    const { run, spentModel } = starting({ tree: "branch" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ticket/721");
    expect(spentModel()).toBe(false);
  });

  it("refuses a tree carrying uncommitted work and spends no model", () => {
    const { run, spentModel } = starting({ tree: "dirty" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("uncommitted");
    expect(spentModel()).toBe(false);
  });

  it("refuses a ticket whose checks already pass, naming the criterion, and spends no model", () => {
    const { run, spentModel } = starting({ npx: CHECK_PASSES });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("criterion 1 already passes");
    expect(spentModel()).toBe(false);
  });

  it("says one line naming the ticket and the commit it starts from", () => {
    const { run } = starting();

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining("#721")] });
  });
});

describe("bin/start rewrites or refuses on paths git's history knows are stale (#794)", () => {
  it("rewrites a claim git records as renamed to its new path, on the ticket itself, and says so in one line", () => {
    const { run, edited } = starting({ body: RENAMED_CLAIM_TICKET, history: renamedAndDeletedHistory });

    const result = run();

    const rewriteLines = result.stderr.split("\n").filter((line) => line.includes("src/old-name.ts") && line.includes("src/new-name.ts"));
    expect(rewriteLines).toHaveLength(1);
    expect(result.status).toBe(0);
    expect(edited()).toContain("src/new-name.ts");
    expect(edited()).not.toContain("src/old-name.ts");
  });

  it("rewrites a renamed path only where the ticket claims it or its check names it, leaving the owner's words and a longer path alone", () => {
    const { run, edited } = starting({ body: RENAMED_BESIDE_WORDS_TICKET, history: renamedAndDeletedHistory });

    const result = run();

    expect(result.status).toBe(0);
    expect(edited()).toContain('"leave src/old-name.ts alone where I said it"');
    expect(edited()).toContain("- src/new-name.ts\n- src/old-name.tsx\n");
    expect(edited()).toContain("--config new.config.ts old-name`");
  });

  it("refuses a claim git records as deleted, naming it, and spends no model", () => {
    const { run, spentModel } = starting({ body: DELETED_CLAIM_TICKET, history: renamedAndDeletedHistory });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/soon-deleted.ts");
    expect(spentModel()).toBe(false);
  });

  it("refuses a check naming a config that does not exist, naming it, and spends no model", () => {
    const { run, spentModel } = starting({ body: MISSING_CONFIG_TICKET, history: renamedAndDeletedHistory });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing.config.ts");
    expect(spentModel()).toBe(false);
  });
});
