import { describe, expect, it } from "vitest";
import { MAIN_RED, misshapenTicket, starting } from "./scenarios.ts";
import { mainRefusals } from "./start.ts";

const CHECK_PASSES = "printf '      Tests  1 passed (1)\\n'\nexit 0\n";

describe("core/bin/start refuses a build before any model runs (#662)", () => {
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

  it("refuses while main is red, naming the check, and spends no model", () => {
    const { run, spentModel } = starting({ checkRuns: MAIN_RED });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("main is red: Core check failure");
    expect(spentModel()).toBe(false);
  });

  it("refuses a ticket whose checks already pass, naming the criterion, and spends no model", () => {
    const { run, spentModel } = starting({ npx: CHECK_PASSES });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("criterion 1 already passes");
    expect(spentModel()).toBe(false);
  });

  it("waits on a check still running rather than reading it as red or green", () => {
    expect(mainRefusals('{"check_runs":[{"name":"Core check","conclusion":null}]}')).toEqual([]);
    expect(mainRefusals('{"check_runs":[{"name":"Old gauntlet","conclusion":"skipped"}]}')).toEqual([]);
    expect(mainRefusals("what gh says when it cannot reach GitHub")).toEqual(["GitHub's answer about main did not parse, so the ticket waits"]);
  });

  it("says one line naming the ticket and the commit it starts from", () => {
    const { run } = starting();

    const result = run();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([expect.stringContaining("#721")]);
  });
});
