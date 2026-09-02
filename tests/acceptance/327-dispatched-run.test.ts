import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENROL_SOURCE, ENROL_SOURCE_RELATIVE, presence } from "./327-enrol.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * Criterion 8 is the only one of #327's with no check command of its own: it is about a whole
 * dispatched run, judged by what one enrolled repository holds afterwards.
 *
 * So this runs the run. Not a function of the lane's, and not an injected seam — the exact command
 * the dispatched job runs, `npx tsx .Workflow/agent-workflows/enrol/enrol.ts`, from the checkout
 * root, with `GH_TOKEN` and the ambient `GITHUB_` variables in its environment. What stands in for
 * GitHub is a fake `gh` at the front of the child's `PATH`: it keeps an estate in a JSON file — this
 * repository, and one repository carrying the enrolment topic — answers reads out of it, applies
 * writes to it, and logs every argv it was handed. The assertions are about that estate after the
 * pass, which is what "leaves one enrolled repository holding..." means.
 *
 * Reaching the lane this way rather than by importing it is what the sealed directory requires: a
 * child process resolves its own imports, and nothing in this file climbs out of
 * `tests/acceptance/`.
 *
 * The fake is deliberately tolerant about *how* a write is spelled — `gh label create`/`gh label
 * edit` or the REST equivalents, `gh secret set`, a `PUT` whose fields arrive as flags or on stdin —
 * and strict about what it records, because the criterion is about the state a target is left in and
 * not about which channel the lane chose to leave it there.
 *
 * The two secret values are handed to the child under their own names for the same reason the real
 * job hands them over: a secret's value cannot be derived, only passed, and a lane with no value to
 * write cannot write one. Which names the lane *propagates* is left to its own derivation — the
 * assertion below counts them and refuses two, never names them.
 */

const MACHINE = "acme/machine";
const ENROLLED = "acme/enrolled";
const TOPIC = "claude-workflow-enrolled";

interface FakeLabel {
  name: string;
  color: string;
  description: string;
}

interface FakeRepo {
  labels: FakeLabel[];
  secrets: Record<string, string>;
  canApprove: boolean;
  topics: string[];
}

interface FakeGitHub {
  machine: string;
  repos: Record<string, FakeRepo>;
}

/**
 * This repository's live label set, as the fake reports it.
 *
 * The third name exists nowhere in this tree, on purpose: a lane that wrote a label list out of a
 * file could never produce it, so finding it on the target afterwards is the proof that the set was
 * read live.
 */
const MACHINE_LABELS: FakeLabel[] = [
  { name: "ticket", color: "0e8a16", description: "A slice of a spec, ready to build" },
  { name: "prd", color: "5319e7", description: "A spec" },
  {
    name: "acceptance-probe-only",
    color: "b60205",
    description: "Carried by the fake estate this probe runs against, and by nothing in the tree",
  },
];

/**
 * The target before the pass: one of this repository's labels carrying the wrong colour and the
 * wrong description, and one stock label GitHub seeds every new repository with, which deleting is
 * not this lane's business.
 */
const TARGET_LABELS: FakeLabel[] = [
  { name: "ticket", color: "ffffff", description: "whatever the target happened to have" },
  { name: "wontfix", color: "ffffff", description: "This will not be worked on" },
];

function initialEstate(): FakeGitHub {
  return {
    machine: MACHINE,
    repos: {
      [MACHINE]: {
        labels: MACHINE_LABELS.map((label) => ({ ...label })),
        secrets: {},
        canApprove: true,
        topics: [],
      },
      [ENROLLED]: {
        labels: TARGET_LABELS.map((label) => ({ ...label })),
        secrets: {},
        canApprove: false,
        topics: [TOPIC],
      },
    },
  };
}

/**
 * The fake `gh`, as plain CommonJS. `String.raw` so a regex escape written here reaches the child as
 * an escape rather than as a newline in this file's own source.
 */
const FAKE_GH = String.raw`
"use strict";
const fs = require("fs");

const argv = process.argv.slice(2);
const statePath = process.env.FAKE_GH_STATE || "";
const logPath = process.env.FAKE_GH_LOG || "";

try {
  fs.appendFileSync(logPath, JSON.stringify(argv) + "\n");
} catch (err) {
  // a log this probe cannot write is a fact about the probe, not about the lane
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const repoNames = Object.keys(state.repos);
const joined = argv.join(" ");

function save() {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

// fs.writeSync rather than process.stdout.write: a write to a pipe followed by process.exit can be
// truncated, and a truncated answer would be a fact about this fake.
function out(text) {
  const body = text === undefined || text === null ? "" : String(text);
  if (body !== "") fs.writeSync(1, body.charAt(body.length - 1) === "\n" ? body : body + "\n");
  process.exit(0);
}

function notFound() {
  fs.writeSync(2, "gh: Not Found (HTTP 404)\n");
  process.exit(1);
}

function flag() {
  const names = Array.prototype.slice.call(arguments);
  for (let i = 0; i < argv.length; i++) {
    for (let j = 0; j < names.length; j++) {
      if (argv[i] === names[j]) return argv[i + 1];
      if (argv[i].indexOf(names[j] + "=") === 0) return argv[i].slice(names[j].length + 1);
    }
  }
  return undefined;
}

const FIELD_FLAGS = ["-f", "-F", "--field", "--raw-field"];
const fields = {};
for (let i = 0; i < argv.length; i++) {
  let pair = null;
  if (FIELD_FLAGS.indexOf(argv[i]) !== -1) {
    pair = argv[i + 1] === undefined ? "" : String(argv[i + 1]);
  } else if (
    (argv[i].indexOf("-f") === 0 || argv[i].indexOf("-F") === 0) &&
    argv[i].length > 2 &&
    argv[i].indexOf("=") !== -1 &&
    argv[i].charAt(1) !== "-"
  ) {
    pair = argv[i].slice(2);
  }
  if (pair === null) continue;
  const at = pair.indexOf("=");
  if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
}

if (argv.indexOf("--input") !== -1) {
  try {
    const where = flag("--input");
    const text = where === undefined || where === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(where, "utf8");
    const parsed = JSON.parse(text);
    Object.keys(parsed).forEach(function (key) {
      fields[key] = parsed[key];
    });
  } catch (err) {
    // a body this fake cannot read leaves the fields as the flags spelled them
  }
}

let method = flag("-X", "--method");
method = String(method === undefined ? (Object.keys(fields).length > 0 ? "POST" : "GET") : method).toUpperCase();

const jq = flag("--jq", "-q");

function positional(from, valueFlags) {
  for (let i = from; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.length > 1 && arg.charAt(0) === "-") {
      if (valueFlags.indexOf(arg) !== -1) i++;
      continue;
    }
    return arg;
  }
  return undefined;
}

function repoOf() {
  const explicit = flag("-R", "--repo");
  if (explicit && state.repos[explicit]) return explicit;
  for (let i = 0; i < repoNames.length; i++) {
    if (joined.indexOf(repoNames[i]) !== -1) return repoNames[i];
  }
  return undefined;
}

function pluck(value, dotted) {
  let current = value;
  const keys = String(dotted).split(".");
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === "") continue;
    if (current === null || current === undefined) return null;
    current = current[keys[i]];
  }
  return current === undefined ? null : current;
}

function simple(text) {
  return /^[A-Za-z0-9_.]*$/.test(text);
}

// Enough of jq to answer the shapes a discovery or a read-back actually uses: a plain path, a
// projection over an array, and either spelling of the pipe. Anything richer falls back to the
// unfiltered value, so an unrecognised filter can never be mistaken for an empty answer.
function jqOne(value, expr) {
  let query = String(expr).trim();
  if (query.charAt(0) === "[" && query.charAt(query.length - 1) === "]") {
    query = query.slice(1, -1).trim();
  }
  query = query.replace(/\s*\|\s*\./g, ".");
  if (query === "" || query === ".") return value;
  const at = query.indexOf("[]");
  if (at === -1) {
    const path = query.replace(/^\./, "");
    return simple(path) ? pluck(value, path) : value;
  }
  const base = query.slice(0, at).replace(/^\./, "");
  const rest = query.slice(at + 2).replace(/^\./, "");
  if (!simple(base)) return value;
  const source = base === "" ? value : pluck(value, base);
  const list = Array.isArray(source) ? source : [];
  if (rest === "" || !simple(rest)) return list;
  return list.map(function (entry) {
    return pluck(entry, rest);
  });
}

function render(value, filter) {
  const result = filter === undefined ? value : jqOne(value, filter);
  if (typeof result === "string") return result;
  if (filter !== undefined && Array.isArray(result)) {
    return result
      .map(function (entry) {
        return typeof entry === "string" ? entry : JSON.stringify(entry);
      })
      .join("\n");
  }
  return JSON.stringify(result);
}

function labelList(repo) {
  const owned = state.repos[repo] ? state.repos[repo].labels : [];
  return owned.map(function (label, index) {
    return {
      id: index + 1,
      node_id: "L_" + String(index + 1),
      name: label.name,
      color: label.color,
      description: label.description,
      "default": false,
    };
  });
}

function oneLabel(repo, name) {
  const found = labelList(repo).filter(function (label) {
    return label.name === name;
  });
  return found.length === 0 ? null : found[0];
}

function upsert(repo, name, color, description, newName) {
  if (!repo || !state.repos[repo] || !name) return;
  const labels = state.repos[repo].labels;
  let found = null;
  for (let i = 0; i < labels.length; i++) if (labels[i].name === name) found = labels[i];
  if (found === null) {
    found = { name: name, color: "ededed", description: "" };
    labels.push(found);
  }
  if (newName) found.name = String(newName);
  if (color !== undefined && color !== null) found.color = String(color).replace(/^#/, "");
  if (description !== undefined && description !== null) found.description = String(description);
  save();
}

function removeLabel(repo, name) {
  if (!repo || !state.repos[repo] || !name) return;
  state.repos[repo].labels = state.repos[repo].labels.filter(function (label) {
    return label.name !== name;
  });
  save();
}

function repoObject(name) {
  const parts = name.split("/");
  const repo = state.repos[name];
  return {
    name: parts[1],
    full_name: name,
    fullName: name,
    nameWithOwner: name,
    owner: { login: parts[0], name: parts[0] },
    url: "https://github.com/" + name,
    html_url: "https://github.com/" + name,
    visibility: "public",
    isPrivate: false,
    "private": false,
    isArchived: false,
    archived: false,
    isFork: false,
    fork: false,
    default_branch: "main",
    defaultBranchRef: { name: "main" },
    topics: repo.topics,
    repositoryTopics: repo.topics.map(function (topic) {
      return { name: topic, topic: { name: topic } };
    }),
  };
}

function wantedTopic() {
  const named = flag("--topic");
  if (named) return named;
  const found = joined.match(/topic:([A-Za-z0-9._-]+)/);
  return found ? found[1] : undefined;
}

function discovered() {
  const topic = wantedTopic();
  return repoNames
    .filter(function (name) {
      return !topic || state.repos[name].topics.indexOf(topic) !== -1;
    })
    .map(repoObject);
}

const command = argv[0];

if (command === "auth") out("Logged in to github.com as acceptance-probe");

if (command === "label") {
  const LABEL_FLAGS = ["-R", "--repo", "-c", "--color", "-d", "--description", "-n", "--name", "--jq", "-q", "--json", "--template", "-L", "--limit"];
  const repo = repoOf() || state.machine;
  const action = argv[1];
  if (action === "list") out(render(labelList(repo), jq));
  const name = positional(2, LABEL_FLAGS);
  if (action === "create") {
    upsert(repo, name, flag("--color", "-c"), flag("--description", "-d"), name);
    out("{}");
  }
  if (action === "edit") {
    upsert(repo, name, flag("--color", "-c"), flag("--description", "-d"), flag("--name", "-n") || name);
    out("{}");
  }
  if (action === "delete") {
    removeLabel(repo, name);
    out("{}");
  }
  out("{}");
}

if (command === "secret") {
  const SECRET_FLAGS = ["-R", "--repo", "-b", "--body", "-e", "--env", "-o", "--org", "-u", "--user", "-a", "--app", "-f", "--env-file", "-v", "--visibility", "-r", "--repos"];
  if (argv[1] === "set") {
    // Drained so a lane handing the value on stdin is not answered with a closed pipe.
    if (flag("-b", "--body") === undefined) {
      try {
        fs.readFileSync(0, "utf8");
      } catch (err) {
        // no body on stdin
      }
    }
    const repo = repoOf();
    const name = positional(2, SECRET_FLAGS);
    if (repo && state.repos[repo] && name) {
      state.repos[repo].secrets[name] = "written";
      save();
    }
    out("");
  }
  if (argv[1] === "list") out(render([], jq));
  out("");
}

if (command === "repo") {
  if (argv[1] === "list") out(render(discovered(), jq));
  if (argv[1] === "view") out(render(repoObject(repoOf() || state.machine), jq));
  out("{}");
}

if (command === "search" && argv[1] === "repos") out(render(discovered(), jq));

if (command === "api") {
  const API_FLAGS = ["-X", "--method", "-f", "-F", "--field", "--raw-field", "-H", "--header", "--jq", "-q", "-t", "--template", "--input", "--hostname", "--cache", "-p", "--preview"];
  const route = positional(1, API_FLAGS) || "";
  const repo = repoOf() || state.machine;

  if (route === "graphql") {
    const nodes = discovered();
    out(
      render(
        {
          data: {
            search: { repositoryCount: nodes.length, nodes: nodes, edges: nodes.map(function (node) { return { node: node }; }) },
            organization: { repositories: { totalCount: nodes.length, nodes: nodes } },
            user: { repositories: { totalCount: nodes.length, nodes: nodes } },
            viewer: { repositories: { totalCount: nodes.length, nodes: nodes } },
          },
        },
        jq,
      ),
    );
  }

  if (route.indexOf("actions/permissions/workflow") !== -1) {
    if (method === "GET") {
      out(
        render(
          {
            default_workflow_permissions: "write",
            can_approve_pull_request_reviews: state.repos[repo].canApprove === true,
          },
          jq,
        ),
      );
    }
    const asked = fields.can_approve_pull_request_reviews;
    if (asked !== undefined) {
      state.repos[repo].canApprove = asked === true || String(asked) === "true";
      save();
    }
    out("");
  }

  const labelled = route.match(/\/labels(?:\/([^/?#]+))?/);
  if (labelled) {
    const named = labelled[1] === undefined ? undefined : decodeURIComponent(labelled[1]);
    if (method === "GET") {
      if (named === undefined) out(render(labelList(repo), jq));
      const one = oneLabel(repo, named);
      if (one === null) notFound();
      out(render(one, jq));
    }
    if (method === "DELETE") {
      removeLabel(repo, named);
      out("");
    }
    const name = fields.name === undefined ? named : String(fields.name);
    const renamed = fields.new_name === undefined ? name : String(fields.new_name);
    upsert(repo, name, fields.color, fields.description, renamed);
    out(render(oneLabel(repo, renamed), jq));
  }

  if (route.indexOf("search/repositories") !== -1) {
    const items = discovered();
    out(render({ total_count: items.length, items: items }, jq));
  }

  if (route.indexOf("/topics") !== -1) out(render({ names: state.repos[repo].topics }, jq));

  if (route.indexOf("/contents/") !== -1) {
    if (method === "GET") notFound();
    const sha = "1111111111111111111111111111111111111111";
    out(render({ content: { sha: sha, path: route }, commit: { sha: sha } }, jq));
  }

  if (route.indexOf("/git/") !== -1) {
    const sha = "2222222222222222222222222222222222222222";
    out(render({ sha: sha, object: { sha: sha, type: "commit" }, tree: { sha: sha }, commit: { sha: sha } }, jq));
  }

  if (/(^|\/)repos$/.test(route.split("?")[0])) out(render(discovered(), jq));

  out(render(method === "GET" ? [] : {}, jq));
}

out("");
`;

interface DispatchedPass {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string;
  estate: FakeGitHub;
}

/** Runs the command the dispatched job runs, against a fake estate, and reports what it left. */
function runDispatchedPass(): DispatchedPass {
  const tmp = mkdtempSync(path.join(tmpdir(), "acceptance-327-"));
  const bin = path.join(tmp, "bin");
  mkdirSync(bin, { recursive: true });

  const statePath = path.join(tmp, "github.json");
  const logPath = path.join(tmp, "gh-calls.log");
  const fake = path.join(tmp, "fake-gh.cjs");
  const shim = path.join(bin, "gh");

  writeFileSync(statePath, JSON.stringify(initialEstate(), null, 2), "utf8");
  writeFileSync(logPath, "", "utf8");
  writeFileSync(fake, FAKE_GH, "utf8");
  writeFileSync(shim, `#!/bin/sh\nexec node ${JSON.stringify(fake)} "$@"\n`, "utf8");
  chmodSync(shim, 0o755);

  try {
    const run = spawnSync("npx", ["tsx", ENROL_SOURCE_RELATIVE], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_GH_STATE: statePath,
        FAKE_GH_LOG: logPath,
        GH_TOKEN: "acceptance-probe-enrol-pat",
        GITHUB_REPOSITORY: MACHINE,
        GITHUB_SHA: "0f1e2d3c4b5a69788796a5b4c3d2e1f009182736",
        CLAUDE_CODE_OAUTH_TOKEN: "acceptance-probe-model-token",
        KNOWLEDGE_BASE_DEPLOY_KEY: "acceptance-probe-deploy-key",
      },
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });

    return {
      status: run.status,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      calls: readFileSync(logPath, "utf8"),
      estate: JSON.parse(readFileSync(statePath, "utf8")) as FakeGitHub,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("#327 — a dispatched enrolment pass", () => {
  // A real dispatched run leaves one enrolled repository holding this repository's label set,
  it("leaves the target holding the labels, the setting and the secrets", () => {
    expect(presence(ENROL_SOURCE_RELATIVE, ENROL_SOURCE)).toBe("present");

    const pass = runDispatchedPass();
    const target = pass.estate.repos[ENROLLED];
    const problems: string[] = [];

    for (const wanted of MACHINE_LABELS) {
      const held = target.labels.find((label) => label.name === wanted.name);
      if (held === undefined) {
        problems.push(`the enrolled repository holds no \`${wanted.name}\` label`);
        continue;
      }
      if (String(held.color).toLowerCase().replace(/^#/, "") !== wanted.color) {
        problems.push(`\`${wanted.name}\` is ${String(held.color)}, not ${wanted.color}`);
      }
      if (String(held.description) !== wanted.description) {
        problems.push(`\`${wanted.name}\` is described "${String(held.description)}"`);
      }
    }

    if (!target.labels.some((label) => label.name === "wontfix")) {
      problems.push("the target's own stock `wontfix` label was taken off it");
    }

    if (target.canApprove !== true) {
      problems.push("can_approve_pull_request_reviews does not read true on the target");
    }

    const written = Object.keys(target.secrets).sort();
    if (written.includes("ENROL_PAT")) problems.push("ENROL_PAT was written to the target");
    if (written.includes("GITHUB_TOKEN")) problems.push("GITHUB_TOKEN was written to the target");
    if (written.length < 2) {
      problems.push(`the target holds ${String(written.length)} secrets: ${written.join(", ") || "(none)"}`);
    }

    if (problems.length > 0) {
      problems.push(
        [
          `\`npx tsx ${ENROL_SOURCE_RELATIVE}\` exited ${String(pass.status)}`,
          `stdout:\n${pass.stdout}`,
          `stderr:\n${pass.stderr}`,
          `gh calls:\n${pass.calls}`,
          `estate:\n${JSON.stringify(pass.estate, null, 2)}`,
        ].join("\n"),
      );
    }

    expect(problems).toEqual([]);
  }, 900_000);
});
