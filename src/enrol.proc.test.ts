import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { bare, CI, DEPLOY, ENROLLED as REPO, enrolling, key } from "./scenarios.ts";

const CALLER = readFileSync(join(import.meta.dirname, "..", ".github", "caller.yml"), "utf8");

describe("bin/enrol leaves a repo with everything Lumaria was given by hand (#1152)", () => {
  it("writes the caller file naming the repo's own CI, reaches it with the App, sets every secret, label and auto-merge, and holds main for check", () => {
    const { run, held } = enrolling(bare());

    const result = run();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const after = held();
    const caller = parse(after.files[".github/workflows/machine.yml"] ?? "") as { on: { workflow_run: { workflows: string[] } } };
    expect(caller.on.workflow_run.workflows).toEqual(["Gate"]);
    expect(after.reached).toContain(REPO);
    expect(after.variables).toEqual(["CORE_APP_CLIENT_ID"]);
    expect(after.secrets.sort()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "CORE_APP_PRIVATE_KEY"]);
    expect(after.dependabot).toEqual(["CORE_APP_PRIVATE_KEY"]);
    expect(after.labels).toEqual(expect.arrayContaining(["bug", "ticket", "spec", "note", "research", "building", "checking", "waiting", "asked", "needs-human"]));
    expect(after.labels).not.toContain("try-");
    expect(after.allow_auto_merge).toBe(true);
    expect(after.rules.map(({ type }) => type)).toEqual(expect.arrayContaining(["pull_request", "required_status_checks"]));
    expect(JSON.stringify(after.rules)).toContain('"context":"check"');
    expect(result.stdout).toBe(`enrol: ${REPO} enrolled, 9 settings set\n`);
  });

  it("writes .github/caller.yml as it stands, but for the name of the repo's CI", () => {
    const { run, held } = enrolling(bare({ files: { ".github/workflows/ci.yml": CI.replace("name: Gate", "name: CI") } }));

    run();

    expect(held().files[".github/workflows/machine.yml"]).toBe(CALLER);
  });

  it("sets each secret from the value in its own environment variable", () => {
    const { run, held } = enrolling(bare());

    run();

    expect(held().writes.filter((args) => args[0] === "secret").map((args) => `${args[2]} ${args.includes("dependabot") ? "dependabot " : ""}${args.at(-1)}`).sort()).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN value sk-token",
      `CORE_APP_PRIVATE_KEY dependabot value ${key()}`,
      `CORE_APP_PRIVATE_KEY value ${key()}`,
    ]);
  });

  it("changes nothing on a repo it already enrolled, and says so", () => {
    const { run, held } = enrolling(bare());
    run();
    const before = held().writes.length;

    const again = run();

    expect(again).toEqual({ status: 0, stdout: `enrol: ${REPO} was already enrolled, nothing changed\n`, stderr: "" });
    expect(held().writes).toHaveLength(before);
  });

  it("refuses and names what it could not set, setting the rest", () => {
    const { run, held } = enrolling(bare({ refused: { "allow_auto_merge=true": "gh: Must have admin rights to Repository. (HTTP 403)" } }), { CORE_APP_PRIVATE_KEY: key() });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr.trimEnd().split("\n")).toEqual([
      `enrol: ${REPO} is not enrolled, 3 could not be set and 6 were:`,
      "- CLAUDE_CODE_OAUTH_TOKEN: no CLAUDE_CODE_OAUTH_TOKEN in the environment to set it from",
      "- auto-merge: gh: Must have admin rights to Repository. (HTTP 403)",
      "- the caller file: auto-merge is off, so a PR for it would never merge on its own",
    ]);
    expect(held().labels).toContain("ticket");
    expect(held().dependabot).toEqual(["CORE_APP_PRIVATE_KEY"]);
  });

  it("shows four of its refusals and counts the rest when GitHub refuses every call", () => {
    const { run } = enrolling(bare({ refused: { "": "gh: Bad credentials (HTTP 401)" } }));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr.trimEnd().split("\n")).toEqual([
      `enrol: ${REPO} is not enrolled, 9 could not be set and 0 were:`,
      "- the App's access: gh: Bad credentials (HTTP 401)",
      "- CORE_APP_CLIENT_ID: gh: Bad credentials (HTTP 401)",
      "- CORE_APP_PRIVATE_KEY: gh: Bad credentials (HTTP 401)",
      "- CORE_APP_PRIVATE_KEY for Dependabot: gh: Bad credentials (HTTP 401)",
      "- and 5 more",
    ]);
  });

  it("refuses the caller file when no one workflow runs a check job on pull requests, naming them", () => {
    const { run, held } = enrolling(bare({ files: { ".github/workflows/deploy.yml": DEPLOY } }));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("- the caller file: no workflow in .github/workflows runs a `check` job on pull requests, so there is no CI to name");
    expect(held().files[".github/workflows/machine.yml"]).toBeUndefined();
    expect(held().rules).toEqual([]);
  });

  it("leaves the App's access alone where it reaches every repo", () => {
    const { run, writes } = enrolling(bare({ selection: "all" }));

    expect(run().status).toBe(0);
    expect(writes().filter((call) => call.includes("installations"))).toEqual([]);
  });

  it("refuses anything but one owner/name", () => {
    const { run, writes } = enrolling(bare());

    expect(run("Next")).toEqual({ status: 2, stdout: "", stderr: "enrol: usage: enrol <owner/repo>\n" });
    expect(writes()).toEqual([]);
  });
});

const STALE = CALLER.replace("    types: [created]\n", "");
const HELD_FOR_CHECK = [{ type: "pull_request" }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "check" }] } }];

describe("bin/enrol keeps an enrolled repo current with the owner's own login (#1155)", () => {
  it("brings a stale caller file up to date through a PR that merges on its own once check passes, where main takes changes only through a PR", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, files: { ".github/workflows/ci.yml": CI.replace("name: Gate", "name: CI"), ".github/workflows/machine.yml": STALE } }));

    const result = run();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(held().files[".github/workflows/machine.yml"]).toBe(CALLER);
    const merged = held().writes.find((args) => args[0] === "pr" && args[1] === "merge") ?? [];
    expect(merged).toEqual(expect.arrayContaining(["--auto"]));
  });

  it("opens the PR afresh from main when a branch is left from an earlier enrolment", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, branches: { "enrol/caller": { "old.txt": "old" } } }));

    expect(run().status).toBe(0);
    expect(held().files[".github/workflows/machine.yml"]).toBeDefined();
    expect(held().files["old.txt"]).toBeUndefined();
  });

  it("reads the App's access with the App's own key and grants it with the owner's login, never listing the owner's installations", () => {
    const { run, held } = enrolling(bare());

    const result = run();

    expect(result.stderr).toBe("");
    expect(held().reached).toContain(REPO);
  });

  it("refuses the App's access, naming the key, when no CORE_APP_PRIVATE_KEY is in the environment to read it with", () => {
    const { run } = enrolling(bare(), { CLAUDE_CODE_OAUTH_TOKEN: "sk-token" });

    expect(run().stderr).toContain("- the App's access: no CORE_APP_PRIVATE_KEY in the environment to read the App's access with");
  });

  it("ends saying a repo enrolled like Lumaria today was already enrolled, and changes nothing", () => {
    const { run, held } = enrolling(bare());
    run();
    const before = held().writes.length;

    expect(run()).toEqual({ status: 0, stdout: `enrol: ${REPO} was already enrolled, nothing changed\n`, stderr: "" });
    expect(held().writes).toHaveLength(before);
  });

  it("writes the caller file straight to main where main still takes direct pushes, opening no PR", () => {
    const { run, held } = enrolling(bare({ files: { ".github/workflows/ci.yml": CI.replace("name: Gate", "name: CI") }, refused: { "/rulesets": "gh: Upgrade to GitHub Pro to enable this feature (HTTP 403)" } }));

    run();

    expect(held().files[".github/workflows/machine.yml"]).toBe(CALLER);
    expect(held().writes.filter((args) => args[0] === "pr")).toEqual([]);
  });

  it("refuses the caller file before opening anything when auto-merge is off, since its PR would never merge on its own", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, refused: { "allow_auto_merge=true": "gh: Must have admin rights to Repository. (HTTP 403)" } }));

    expect(run().stderr).toContain("- the caller file: auto-merge is off, so a PR for it would never merge on its own");
    expect(held().prs).toEqual([]);
    expect(held().branches).toEqual({});
  });

  it("closes its PR and deletes its branch when GitHub refuses to merge the PR on its own", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, refused: { "pr merge": "GraphQL: Pull request Protected branch rules not configured for this branch (enablePullRequestAutoMerge)" } }));

    expect(run().stderr).toContain("- the caller file: GraphQL: Pull request Protected branch rules not configured");
    expect(held().prs).toEqual([]);
    expect(held().branches).toEqual({});
  });

  it("names the merge refusal and the failed cleanup when cleaning up its PR fails too", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, refused: { "pr merge": "GraphQL: Protected branch rules not configured", "pr close": "gh: Resource not accessible (HTTP 403)" } }));

    expect(run().stderr).toContain("- the caller file: GraphQL: Protected branch rules not configured, and cleaning up its PR and branch failed too: gh: Resource not accessible (HTTP 403)");
    expect(held().prs).toHaveLength(1);
  });

  it("deletes its branch, leaving no PR, when GitHub refuses to open the PR (#1157)", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, refused: { "pr create": "pull request create failed: GraphQL: Resource not accessible by integration (createPullRequest)" } }));

    expect(run().stderr).toContain("- the caller file: pull request create failed: GraphQL: Resource not accessible by integration");
    expect(held().prs).toEqual([]);
    expect(held().branches).toEqual({});
  });

  it("deletes its branch when GitHub refuses the caller file written to it (#1157)", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, refused: { "branch=enrol/caller": "gh: Resource not accessible by integration (HTTP 403)" } }));

    expect(run().stderr).toContain("- the caller file: gh: Resource not accessible by integration (HTTP 403)");
    expect(held().prs).toEqual([]);
    expect(held().branches).toEqual({});
  });

  it("names the caller PR still waiting on check, and leaves it alone on a re-run", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, pending: true, files: { ".github/workflows/ci.yml": CI, ".github/workflows/machine.yml": STALE } }));
    const waiting = `- the caller file: https://github.com/${REPO}/pull/900 merges on its own once check passes`;

    expect(run().stdout).toBe(`enrol: ${REPO} is enrolled once its PR merges, 7 settings set:\n${waiting}\n`);
    const before = held().writes.length;

    expect(run()).toEqual({ status: 0, stdout: `enrol: ${REPO} is enrolled once its PR merges, 0 settings set:\n${waiting}\n`, stderr: "" });
    expect(held().writes).toHaveLength(before);
    expect(held().prs.map(({ auto }) => auto)).toEqual([true]);
  });
});
