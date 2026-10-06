import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BIN, execute, scratch } from "./scenarios.ts";
import { MACHINE } from "./spelled.ts";

const REPO = "collod873/Next";
const CALLER = readFileSync(join(import.meta.dirname, "..", ".github", "caller.yml"), "utf8");
const CI = ["name: Gate", "on:", "  pull_request:", "jobs:", "  check:", "    runs-on: ubuntu-latest", "    steps:", "      - run: pnpm check", ""].join("\n");
const DEPLOY = ["name: Deploy", "on:", "  push:", "jobs:", "  ship:", "    runs-on: ubuntu-latest", "    steps:", "      - run: ./ship", ""].join("\n");
const SECRETS = { CORE_APP_PRIVATE_KEY: "-----BEGIN KEY-----", CLAUDE_CODE_OAUTH_TOKEN: "sk-token" };

interface Held {
  id: number;
  allow_auto_merge: boolean;
  files: Record<string, string>;
  selection: string;
  reached: string[];
  variables: string[];
  secrets: string[];
  dependabot: string[];
  labels: string[];
  rules: { type: string; parameters?: unknown }[];
  refused: Record<string, string>;
  writes: string[][];
}

const FAKE_GH = String.raw`
const fs = require("node:fs");
const path = process.env.HELD;
const held = JSON.parse(fs.readFileSync(path, "utf8"));
const args = process.argv.slice(2);
const said = args.join(" ");
const save = () => fs.writeFileSync(path, JSON.stringify(held));
const out = (value) => process.stdout.write(JSON.stringify(value));
const refusal = Object.keys(held.refused).find((pattern) => said.includes(pattern));
const wrote = () => { held.writes.push(args); save(); };
if (refusal !== undefined) { wrote(); process.stderr.write(held.refused[refusal] + "\n"); process.exit(1); }
const flag = (name) => args[args.indexOf(name) + 1];
const method = args.includes("-X") ? flag("-X") : "GET";
const route = args.find((arg, at) => at > 0 && !arg.startsWith("-") && !["-X", "-H", "-f", "-F", "--input"].includes(args[at - 1]));
const fields = Object.fromEntries(args.flatMap((arg, at) => (["-f", "-F"].includes(args[at - 1]) ? [arg.split(/=(.*)/s).slice(0, 2)] : [])));
const stdin = () => fs.readFileSync(0, "utf8");
const repo = "${REPO}";
const contents = "repos/" + repo + "/contents/";
if (args[0] === "api" && method === "GET" && route === "repos/" + repo) out({ id: held.id, allow_auto_merge: held.allow_auto_merge, default_branch: "main" });
else if (args[0] === "api" && method === "PATCH" && route === "repos/" + repo) { wrote(); held.allow_auto_merge = fields.allow_auto_merge === "true"; save(); out({}); }
else if (args[0] === "api" && method === "GET" && route === contents + ".github/workflows") {
  const listed = Object.keys(held.files).filter((file) => file.startsWith(".github/workflows/"));
  if (listed.length === 0) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out(listed.map((file) => ({ path: file, type: "file" })));
}
else if (args[0] === "api" && method === "GET" && route.startsWith(contents)) {
  const file = route.slice(contents.length);
  if (held.files[file] === undefined) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out({ path: file, sha: "sha-" + file.length, content: Buffer.from(held.files[file]).toString("base64") });
}
else if (args[0] === "api" && method === "PUT" && route.startsWith(contents)) { wrote(); held.files[route.slice(contents.length)] = Buffer.from(fields.content, "base64").toString("utf8"); save(); out({}); }
else if (args[0] === "api" && route === "user/installations") out({ installations: [{ id: 77, app_slug: "${MACHINE.replace("[bot]", "")}", repository_selection: held.selection }, { id: 78, app_slug: "other", repository_selection: "all" }] });
else if (args[0] === "api" && method === "GET" && route.startsWith("user/installations/77/repositories")) out([{ repositories: held.reached.map((full_name) => ({ full_name })) }]);
else if (args[0] === "api" && method === "PUT" && route === "user/installations/77/repositories/" + held.id) { wrote(); held.reached.push(repo); save(); }
else if (args[0] === "api" && route === "apps/${MACHINE.replace("[bot]", "")}") out({ client_id: "Iv23client" });
else if (args[0] === "api" && route === "repos/" + repo + "/rules/branches/main") out(held.rules);
else if (args[0] === "api" && method === "POST" && route === "repos/" + repo + "/rulesets") { wrote(); held.rules.push(...JSON.parse(stdin()).rules); held.writes.at(-1).push("ruleset"); save(); out({}); }
else if (args[0] === "variable" && args[1] === "list") out(held.variables.map((name) => ({ name })));
else if (args[0] === "variable" && args[1] === "set") { wrote(); held.variables.push(args[2]); save(); }
else if (args[0] === "secret" && args[1] === "list") out((args.includes("dependabot") ? held.dependabot : held.secrets).map((name) => ({ name })));
else if (args[0] === "secret" && args[1] === "set") { wrote(); held.writes.at(-1).push("value " + stdin()); (args.includes("dependabot") ? held.dependabot : held.secrets).push(args[2]); save(); }
else if (args[0] === "label" && args[1] === "list") out(held.labels.map((name) => ({ name })));
else if (args[0] === "label" && args[1] === "create") { wrote(); held.labels.push(args[2]); save(); }
else { process.stderr.write("fake gh: unknown call " + said + "\n"); process.exit(9); }
`;

function bare(extra: Partial<Held> = {}): Held {
  return {
    id: 4242,
    allow_auto_merge: false,
    files: { ".github/workflows/ci.yml": CI, ".github/workflows/deploy.yml": DEPLOY },
    selection: "selected",
    reached: ["collod873/claude-workflow"],
    variables: [],
    secrets: [],
    dependabot: [],
    labels: ["bug"],
    rules: [],
    refused: {},
    writes: [],
    ...extra,
  };
}

function enrolling(held: Held, env: Record<string, string> = SECRETS) {
  const root = scratch("enrol-");
  const state = join(root, "held.json");
  writeFileSync(state, JSON.stringify(held));
  writeFileSync(join(root, "gh"), `#!/usr/bin/env node\n${FAKE_GH}`);
  chmodSync(join(root, "gh"), 0o755);
  const now = () => JSON.parse(readFileSync(state, "utf8")) as Held;
  return {
    run: (...args: string[]) => execute(join(BIN, "enrol"), root, { PATH: `${root}:${process.env.PATH}`, HELD: state, CORE_APP_PRIVATE_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "", ...env }, args.length === 0 ? [REPO] : args),
    held: now,
    writes: () => now().writes.map((args) => args.slice(0, 3).join(" ")),
  };
}

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
    expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(new RegExp(`^enrol: ${REPO} enrolled, set: `));
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
      `enrol: ${REPO} is not enrolled, these could not be set:`,
      "- CLAUDE_CODE_OAUTH_TOKEN: no CLAUDE_CODE_OAUTH_TOKEN in the environment to set it from",
      "- auto-merge: gh: Must have admin rights to Repository. (HTTP 403)",
    ]);
    expect(held().labels).toContain("ticket");
    expect(held().dependabot).toEqual(["CORE_APP_PRIVATE_KEY"]);
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
