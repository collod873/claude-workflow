import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, NOISE, PC_RUNS_ON, appKeys, execute, key, scratch } from "./scenarios.ts";
import { MACHINE, OWNER } from "./spelled.ts";
import { declarePart } from "./part-files.ts";


export const ENROLLED = "collod873/Next";
export const CI_ON_EVERY_PR = ["name: Gate", "on:", "  pull_request:", "jobs:", "  check:", `    runs-on: ${PC_RUNS_ON}`, "    steps:", "      - run: check --full", ""].join("\n");
export const checkJobRule = () => (/^ {2}check:\n((?: {4}.*\n)+?) {4}runs-on:/m.exec(readFileSync(join(import.meta.dirname, "..", "shared", "ci.yml"), "utf8"))?.[1] ?? "").trimEnd().split("\n");
export const ci = () => CI_ON_EVERY_PR.replace("  check:\n", ["  check:", ...checkJobRule(), ""].join("\n"));
export const DEPLOY = ["name: Deploy", "on:", "  push:", "jobs:", "  ship:", `    runs-on: ${PC_RUNS_ON}`, "    steps:", "      - run: ./ship", ""].join("\n");
interface Held {
  repo: string;
  id: number;
  allow_auto_merge: boolean;
  files: Record<string, string>;
  branches: Record<string, Record<string, string>>;
  prs: { number: number; head: string; auto: boolean }[];
  pending: boolean;
  selection: string;
  reached: string[];
  variables: string[];
  secrets: string[];
  dependabot: string[];
  labels: string[];
  looks: Record<string, { color: string; description: string }>;
  appKey: string;
  rules: { type: string; ruleset_id?: number; parameters?: unknown }[];
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
const repo = held.repo;
const contents = "repos/" + repo + "/contents/";
if (args[0] === "api" && method === "GET" && route === "repos/" + repo) out({ id: held.id, allow_auto_merge: held.allow_auto_merge, default_branch: "main" });
else if (args[0] === "api" && method === "PATCH" && route === "repos/" + repo) { wrote(); held.allow_auto_merge = fields.allow_auto_merge === "true"; save(); out({}); }
else if (args[0] === "api" && method === "GET" && route.startsWith(contents)) {
  const [file, ref] = route.slice(contents.length).split("?ref=");
  const files = ref === undefined ? held.files : held.branches[ref] ?? {};
  const listed = Object.keys(files).filter((held) => held.startsWith(file + "/"));
  if (files[file] === undefined && listed.length > 0) out(listed.map((held) => ({ path: held, type: "file" })));
  else if (files[file] === undefined) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  else out({ path: file, sha: "sha-" + file.length, content: Buffer.from(files[file]).toString("base64") });
}
else if (args[0] === "api" && method === "PUT" && route.startsWith(contents)) {
  wrote();
  const branch = fields.branch;
  if (branch === undefined && held.rules.some(({ type }) => type === "pull_request")) { process.stderr.write("gh: Repository rule violations found\n"); process.exit(1); }
  (branch === undefined ? held.files : held.branches[branch])[route.slice(contents.length)] = Buffer.from(fields.content, "base64").toString("utf8");
  save();
  out({});
}
else if (args[0] === "api" && method === "DELETE" && route.startsWith(contents)) {
  wrote();
  const branch = fields.branch;
  if (branch === undefined && held.rules.some(({ type }) => type === "pull_request")) { process.stderr.write("gh: Repository rule violations found\n"); process.exit(1); }
  delete (branch === undefined ? held.files : held.branches[branch])[route.slice(contents.length)];
  save();
  out({});
}
else if (args[0] === "api" && method === "GET" && route === "repos/" + repo + "/git/ref/heads/main") out({ object: { sha: "main-sha" } });
else if (args[0] === "api" && method === "POST" && route === "repos/" + repo + "/git/refs") {
  wrote();
  const branch = fields.ref.replace("refs/heads/", "");
  if (held.branches[branch] !== undefined) { process.stderr.write("gh: Reference already exists (HTTP 422)\n"); process.exit(1); }
  held.branches[branch] = { ...held.files };
  save();
  out({});
}
else if (args[0] === "api" && method === "PATCH" && route.startsWith("repos/" + repo + "/git/refs/heads/")) {
  wrote();
  const branch = route.slice(("repos/" + repo + "/git/refs/heads/").length);
  held.branches[branch] = { ...held.files };
  held.prs = held.prs.filter(({ head }) => head !== branch);
  save();
  out({});
}
else if (args[0] === "api" && method === "DELETE" && route.startsWith("repos/" + repo + "/git/refs/heads/")) { wrote(); delete held.branches[route.slice(("repos/" + repo + "/git/refs/heads/").length)]; save(); }
else if (args[0] === "pr" && args[1] === "list") out(held.prs.filter(({ head }) => head === flag("--head")).map(({ number }) => ({ number, url: "https://github.com/" + repo + "/pull/" + number })));
else if (args[0] === "pr" && args[1] === "close") { wrote(); held.prs = held.prs.filter(({ head }) => head !== args[2]); if (args.includes("--delete-branch")) delete held.branches[args[2]]; save(); }
else if (args[0] === "pr" && args[1] === "create") { wrote(); const number = 900 + held.prs.length; held.prs.push({ number, head: flag("--head"), auto: false }); save(); process.stdout.write("https://github.com/" + repo + "/pull/" + number + "\n"); }
else if (args[0] === "pr" && args[1] === "merge") {
  wrote();
  const pr = held.prs.find(({ number, head }) => String(number) === args[2] || head === args[2]);
  if (pr === undefined) { process.stderr.write("GraphQL: Pull request Pull request is closed (enablePullRequestAutoMerge)\n"); process.exit(1); }
  if (!held.allow_auto_merge || !args.includes("--auto")) { process.stderr.write("GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)\n"); process.exit(1); }
  pr.auto = true;
  if (held.pending) { save(); process.exit(0); }
  held.files = { ...held.branches[pr.head] };
  held.prs = held.prs.filter((open) => open !== pr);
  delete held.branches[pr.head];
  save();
}
else if (args[0] === "api" && route.startsWith("user/installations") && method === "GET") { process.stderr.write("gh: You must authenticate with an access token authorized to a GitHub App in order to list installations (HTTP 403)\n"); process.exit(1); }
else if (args[0] === "api" && (route === "repos/" + repo + "/installation" || route === "users/collod873/installation")) {
  const bearer = (args.find((arg) => arg.startsWith("Authorization: Bearer ")) ?? "").slice("Authorization: Bearer ".length);
  const [head, body, signature] = bearer.split(".");
  const signed = signature !== undefined && require("node:crypto").verify("RSA-SHA256", Buffer.from(head + "." + body), held.appKey, Buffer.from(signature, "base64url"));
  const claims = signed ? JSON.parse(Buffer.from(body, "base64url").toString("utf8")) : {};
  if (!signed || claims.iss !== "Iv23client" || claims.exp <= Date.now() / 1000) { process.stderr.write("gh: A JSON web token could not be decoded (HTTP 401)\n"); process.exit(1); }
  if (route.startsWith("repos/") && held.selection !== "all" && !held.reached.includes(repo)) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out({ id: 77, repository_selection: held.selection });
}
else if (args[0] === "api" && method === "PUT" && route === "user/installations/77/repositories/" + held.id) {
  wrote();
  if (args.some((arg) => arg.startsWith("Authorization:"))) { process.stderr.write("gh: This endpoint only works for PATs (classic) (HTTP 403)\n"); process.exit(1); }
  held.reached.push(repo);
  save();
}
else if (args[0] === "api" && route === "apps/${MACHINE.replace("[bot]", "")}") out({ client_id: "Iv23client" });
else if (args[0] === "api" && route === "repos/" + repo + "/rules/branches/main") out(held.rules);
else if (args[0] === "api" && method === "POST" && route === "repos/" + repo + "/rulesets") { wrote(); held.rules.push(...JSON.parse(stdin()).rules); held.writes.at(-1).push("ruleset"); save(); out({}); }
else if (args[0] === "api" && method === "GET" && route.startsWith("repos/" + repo + "/rulesets/")) {
  const id = Number(route.split("/").at(-1));
  const rules = held.rules.filter((rule) => rule.ruleset_id === id);
  if (rules.length === 0) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out({ id, name: "main lands only through a PR", target: "branch", enforcement: "active", conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }, rules });
}
else if (args[0] === "api" && method === "PUT" && route.startsWith("repos/" + repo + "/rulesets/")) {
  wrote();
  const id = Number(route.split("/").at(-1));
  held.rules = [...held.rules.filter((rule) => rule.ruleset_id !== id), ...JSON.parse(stdin()).rules.map((rule) => ({ ...rule, ruleset_id: id }))];
  held.writes.at(-1).push("ruleset");
  save();
  out({});
}
else if (args[0] === "api" && method === "DELETE" && route.startsWith("repos/" + repo + "/rulesets/")) {
  wrote();
  const id = Number(route.split("/").at(-1));
  held.rules = held.rules.filter((rule) => rule.ruleset_id !== id);
  held.writes.at(-1).push("ruleset");
  save();
}
else if (args[0] === "variable" && args[1] === "list") out(held.variables.map((name) => ({ name })));
else if (args[0] === "variable" && args[1] === "set") { wrote(); held.variables.push(args[2]); save(); }
else if (args[0] === "secret" && args[1] === "list") out((args.includes("dependabot") ? held.dependabot : held.secrets).map((name) => ({ name })));
else if (args[0] === "secret" && args[1] === "set") { wrote(); held.writes.at(-1).push("value " + stdin()); (args.includes("dependabot") ? held.dependabot : held.secrets).push(args[2]); save(); }
else if (args[0] === "label" && args[1] === "list") out(held.labels.map((name) => ({ name, color: "ededed", description: "", ...held.looks[name] })));
else if (args[0] === "label" && args[1] === "create") { wrote(); held.labels.push(args[2]); held.looks[args[2]] = { color: flag("--color"), description: flag("--description") }; save(); }
else if (args[0] === "label" && args[1] === "edit") { wrote(); held.looks[args[2]] = { color: flag("--color"), description: flag("--description") }; save(); }
else if (args[0] === "label" && args[1] === "delete") { wrote(); held.labels = held.labels.filter((name) => name !== args[2]); save(); }
else { process.stderr.write("fake gh: unknown call " + said + "\n"); process.exit(9); }
`;

export function bare(extra: Partial<Held> = {}): Held {
  return {
    repo: ENROLLED,
    id: 4242,
    allow_auto_merge: false,
    files: { ".github/workflows/ci.yml": ci(), ".github/workflows/deploy.yml": DEPLOY },
    branches: {},
    prs: [],
    pending: false,
    selection: "selected",
    reached: ["collod873/claude-workflow"],
    variables: [],
    secrets: [],
    dependabot: [],
    labels: ["bug"],
    looks: {},
    appKey: appKeys().publicKey,
    rules: [],
    refused: {},
    writes: [],
    ...extra,
  };
}

export const HOME = `${OWNER}/claude-workflow`;
const HOME_RULES: Held["rules"] = [
  { type: "pull_request", ruleset_id: 3 },
  { type: "required_status_checks", ruleset_id: 3, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "check" }, { context: "review" }] } },
];
export const home = () =>
  bare({
    repo: HOME,
    allow_auto_merge: true,
    rules: HOME_RULES,
    files: Object.fromEntries([".github/workflows/check.yml", ".github/workflows/machine.yml", ".github/workflows/tickets.yml"].map((path) => [path, readFileSync(join(import.meta.dirname, "..", path), "utf8")])),
  });

export function enrolling(held: Held, env: Record<string, string> = { CORE_APP_PRIVATE_KEY: key(), CLAUDE_CODE_OAUTH_TOKEN: "sk-token", CLAUDE_CODE_OAUTH_TOKEN_2: "sk-token-2" }) {
  const root = scratch("enrol-");
  const state = join(root, "held.json");
  writeFileSync(state, JSON.stringify(held));
  writeFileSync(join(root, "gh"), `#!/usr/bin/env node\n${FAKE_GH}`);
  chmodSync(join(root, "gh"), 0o755);
  const now = () => JSON.parse(readFileSync(state, "utf8")) as Held;
  return {
    run: (...args: string[]) => execute(join(BIN, "enrol"), root, { PATH: `${root}:${process.env.PATH}`, HELD: state, CORE_APP_PRIVATE_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "", CLAUDE_CODE_OAUTH_TOKEN_2: "", ...env }, args.length === 0 ? [held.repo] : args),
    held: now,
    writes: () => now().writes.map((args) => args.slice(0, 3).join(" ")),
  };
}

declarePart({
  part: {
    name: "bin/enrol",
    file: "bin/enrol",
    stops: "https://github.com/collod873/claude-workflow/issues/1150",
    lines: 6,
  },
  scenarios: [
    { label: "enrolling a bare repo", run: () => enrolling(bare()).run() },
    { label: "with GitHub refusing every call", run: () => enrolling(bare({ refused: { "": NOISE } })).run() },
  ],
});
