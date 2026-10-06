import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { bare, CI, DEPLOY, ENROLLED as REPO, enrolling } from "./scenarios.ts";

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
      "CORE_APP_PRIVATE_KEY dependabot value -----BEGIN KEY-----",
      "CORE_APP_PRIVATE_KEY value -----BEGIN KEY-----",
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
    const { run, held } = enrolling(bare({ refused: { "allow_auto_merge=true": "gh: Must have admin rights to Repository. (HTTP 403)" } }), { CORE_APP_PRIVATE_KEY: "-----BEGIN KEY-----" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr.trimEnd().split("\n")).toEqual([
      `enrol: ${REPO} is not enrolled, 2 could not be set and 7 were:`,
      "- CLAUDE_CODE_OAUTH_TOKEN: no CLAUDE_CODE_OAUTH_TOKEN in the environment to set it from",
      "- auto-merge: gh: Must have admin rights to Repository. (HTTP 403)",
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
      "- the caller file: gh: Bad credentials (HTTP 401)",
      "- the App's access: gh: Bad credentials (HTTP 401)",
      "- CORE_APP_CLIENT_ID: gh: Bad credentials (HTTP 401)",
      "- CORE_APP_PRIVATE_KEY: gh: Bad credentials (HTTP 401)",
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
