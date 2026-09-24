import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { machinePage, signedRules } from "./machine-page.ts";
import { parts } from "./parts.ts";
import { execute, git, scratch } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const CALLER = join(REPO, "bin", "machine-page");

function pageIn(repo: string): { path: string; shown: string } {
  const path = join(git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"), "machine-logs", "machine-page.txt");
  return { path, shown: path.startsWith(`${repo}/`) ? path.slice(repo.length + 1) : path };
}

describe("the machine page renders from a part that runs (#710)", () => {
  it("renders the page and says one line naming it", () => {
    expect(parts.map((part) => part.file)).toContain("bin/machine-page");

    const { path, shown } = pageIn(REPO);
    const { status, stdout, stderr } = execute(CALLER, REPO);

    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout.trimEnd().split("\n")).toEqual([expect.stringContaining(shown)]);
    expect(readFileSync(path, "utf8").trimEnd()).toBe(machinePage(parts, signedRules(REPO)));
  });

  it("credits a rule GitHub holds to the part that reads the live ruleset", () => {
    const page = machinePage(parts, signedRules(REPO));

    expect(page).toContain("Nobody pushes to main, the owner included  ← src/rulesets.proc.test.ts");
    expect(page.split("NOT ENFORCED YET")[1]).not.toContain("Nobody pushes to main");
  });

  it("names filing and the start step together on the ticket shape rules they share", () => {
    const page = machinePage(parts, signedRules(REPO));

    expect(page).toContain("A ticket has 1 to 3 criteria (a trial), each with one `check:`  ← bin/file-issue, bin/start");
    expect(page).toContain("Checks test the behaviour meant, not a stand-in like a file or a text m…  ← bin/file-issue, bin/start");
    expect(page).toContain("A build starts only from fresh main, and not when the ticket's checks a…  ← bin/start");
    expect(page.split("NOT ENFORCED YET")[1]).not.toContain("A ticket has 1 to 3 criteria");
  });

  it("says one line and fails where there is no repo to read", () => {
    const { status, stdout, stderr } = execute(CALLER, scratch("machine-page-"));

    expect(status).not.toBe(0);
    expect((stdout + stderr).trimEnd().split("\n")).toHaveLength(1);
  });
});
