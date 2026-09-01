import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh.ts";
import { ENROLMENT_TOPIC, exitCodeFor, runEnrol, type RepositoryOutcome } from "./enrol.ts";
import { blobSha, planFor, readStubSet, type RemoteFile } from "./stub-set.ts";

/**
 * The enrol lane, asserted against a stand-in GitHub (#326). Every write this lane makes lands in
 * somebody else's repository, so "it wrote nothing" is the property that most needs proving and the
 * one a live test could never prove safely — the fake records every argv, and a quiet run is a run
 * whose recording holds no write.
 */

/** A caller stub's bytes. The content is arbitrary; only its identity across the wire matters. */
function stubBody(lane: string): string {
  return `name: ${lane}\n\n"on":\n  workflow_dispatch:\n`;
}

/** A throwaway `.github/workflows` holding the named stubs, plus one workflow that is not a stub. */
function machineWorkflows(lanes: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "enrol-machine-"));
  for (const lane of lanes) writeFileSync(join(dir, `${lane}-caller.yml`), stubBody(lane));
  // The enrol lane itself: a workflow with no caller, which is how it stays out of its own output.
  writeFileSync(join(dir, "enrol.yml"), "name: Enrol\n");
  return dir;
}

interface FakeRepo {
  /** What `.github/workflows` holds, as the contents API would list it. */
  files: RemoteFile[];
  /** When set, every call touching this repository throws with this message. */
  refuses?: string;
  /** When true, the repository has no commit on its default branch. */
  empty?: boolean;
}

interface Wire {
  gh: GhExec;
  calls: string[][];
  /** Every git tree this fake was asked to create, by repository, already parsed. */
  trees: Map<string, Array<{ path: string; sha: string | null }>>;
  /** Every commit message this fake was asked to write, by repository. */
  messages: Map<string, string>;
}

/** Enough of GitHub for one enrolment pass: the search, the contents listing, and the git data API. */
function createWire(repos: Record<string, FakeRepo>): Wire {
  const calls: string[][] = [];
  const trees = new Map<string, Array<{ path: string; sha: string | null }>>();
  const messages = new Map<string, string>();

  /** Which repository an argv is about — every path this lane sends starts `repos/<owner>/<name>`. */
  const repoOf = (path: string): string | undefined => {
    const match = path.match(/^repos\/([^/]+\/[^/?]+)/);
    return match?.[1];
  };

  /** The REST path in a `gh api` argv, past whatever leading flags it carries. */
  const pathIn = (args: string[]): string => {
    const rest = args.slice(1);
    let at = 0;
    while (at < rest.length) {
      if (rest[at] === "--paginate") at += 1;
      else if (rest[at] === "--method") at += 2;
      else break;
    }
    return rest[at] ?? "";
  };

  const gh: GhExec = (args) => {
    calls.push([...args]);
    const path = pathIn(args);

    if (path.startsWith("search/repositories")) {
      expect(path).toContain(`topic:${ENROLMENT_TOPIC}`);
      return `${Object.keys(repos).join("\n")}\n`;
    }

    const name = repoOf(path);
    const repo = name === undefined ? undefined : repos[name];
    if (name === undefined || repo === undefined) {
      throw new Error(`fake gh: no repository in ${JSON.stringify(args)}`);
    }
    if (repo.refuses) throw new Error(repo.refuses);

    if (path === `repos/${name}`) return "main\n";

    if (path.startsWith(`repos/${name}/contents/`)) {
      return `${JSON.stringify(repo.files)}\n`;
    }

    if (path === `repos/${name}/git/ref/heads/main`) {
      if (repo.empty) throw new Error("gh: Not Found (HTTP 404)");
      return "headsha\n";
    }

    if (path.startsWith(`repos/${name}/git/commits/`)) return "basetree\n";

    if (path === `repos/${name}/git/blobs`) return "newblob\n";

    if (path === `repos/${name}/git/trees`) {
      const body = JSON.parse(readFileSync(args[args.indexOf("--input") + 1], "utf8")) as {
        tree: Array<{ path: string; sha: string | null }>;
      };
      trees.set(name, body.tree);
      return "newtree\n";
    }

    if (path === `repos/${name}/git/commits`) {
      const body = JSON.parse(readFileSync(args[args.indexOf("--input") + 1], "utf8")) as { message: string };
      messages.set(name, body.message);
      return "newcommit\n";
    }

    if (path === `repos/${name}/git/refs/heads/main`) return "";

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, trees, messages };
}

/** Every call that changes something — what a run over a current estate must not contain. */
function writeCalls(calls: string[][]): string[][] {
  return calls.filter((argv) => argv.includes("--method") && argv[argv.indexOf("--method") + 1] !== "GET");
}

function outcomeFor(outcomes: RepositoryOutcome[], repository: string): RepositoryOutcome {
  const found = outcomes.find((outcome) => outcome.repository === repository);
  if (found === undefined) throw new Error(`no outcome for ${repository}`);
  return found;
}

function enrol(workflowsDir: string, wire: Wire): RepositoryOutcome[] {
  return runEnrol({
    gh: wire.gh,
    workflowsDir,
    topic: ENROLMENT_TOPIC,
    machineRepository: "owner/machine",
    machineSha: "abc123",
    log: () => {},
  });
}

describe("the stub set is a glob, and a boundary", () => {
  it("ships every *-caller.yml and nothing else in the directory", () => {
    const names = readStubSet(machineWorkflows(["verify", "audit"])).map((stub) => stub.name);

    expect(names).toEqual(["audit-caller.yml", "verify-caller.yml"]);
  });

  it("never proposes deleting a target file outside the glob, however stale", () => {
    const stubs = readStubSet(machineWorkflows(["verify"]));
    const plan = planFor(stubs, [
      { name: "verify-caller.yml", sha: stubs[0].sha },
      { name: "their-own-ci.yml", sha: "whatever" },
      { name: "gone-caller.yml", sha: "stale" },
    ]);

    expect(plan.deletes.map((file) => file.name)).toEqual(["gone-caller.yml"]);
    expect(plan.unchanged).toEqual(["verify-caller.yml"]);
    expect(plan.writes).toEqual([]);
  });

  it("hashes a stub the way git does, so an unchanged file compares equal to what GitHub reports", () => {
    // The empty blob's sha is a fixed, published constant — the one value that proves this is the
    // git object hash and not a plain sha1 of the bytes.
    expect(blobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("a pass over a target that is already current", () => {
  it("writes nothing at all", () => {
    const dir = machineWorkflows(["verify", "audit"]);
    const stubs = readStubSet(dir);
    const wire = createWire({
      "owner/current": { files: stubs.map((stub) => ({ name: stub.name, sha: stub.sha })) },
    });

    const outcomes = enrol(dir, wire);

    expect(outcomeFor(outcomes, "owner/current").code).toBe("current");
    expect(writeCalls(wire.calls)).toEqual([]);
  });
});

describe("a pass over a target that has drifted", () => {
  it("carries writes and deletes in one commit, and touches nothing outside the glob", () => {
    const dir = machineWorkflows(["verify", "audit"]);
    const stubs = readStubSet(dir);
    const wire = createWire({
      "owner/drifted": {
        files: [
          { name: "verify-caller.yml", sha: stubs.find((s) => s.name === "verify-caller.yml")?.sha ?? "" },
          { name: "audit-caller.yml", sha: "an-older-version" },
          { name: "retired-caller.yml", sha: "left-behind" },
          { name: "their-own-ci.yml", sha: "not-ours" },
        ],
      },
    });

    const outcomes = enrol(dir, wire);
    const outcome = outcomeFor(outcomes, "owner/drifted");

    expect(outcome.code).toBe("written");
    expect(outcome.wrote).toEqual(["audit-caller.yml"]);
    expect(outcome.deleted).toEqual(["retired-caller.yml"]);

    const tree = wire.trees.get("owner/drifted") ?? [];
    expect(tree).toEqual([
      { path: ".github/workflows/audit-caller.yml", mode: "100644", type: "blob", sha: "newblob" },
      { path: ".github/workflows/retired-caller.yml", mode: "100644", type: "blob", sha: null },
    ]);
    // One commit, not one per file: a push per stub would fire the target's own Verify lane once
    // per stub, which is what the batching exists to avoid.
    expect(wire.calls.filter((argv) => argv.includes("repos/owner/drifted/git/commits"))).toHaveLength(1);
    expect(wire.messages.get("owner/drifted")).toContain("Machine-Sha: abc123");
  });
});

describe("a repository the token cannot write", () => {
  it("is reported as failed while the rest of the estate is still brought up to date", () => {
    const dir = machineWorkflows(["verify"]);
    const wire = createWire({
      "owner/forbidden": { files: [], refuses: "gh: Resource not accessible by integration (HTTP 403)" },
      "owner/reachable": { files: [] },
    });

    const outcomes = enrol(dir, wire);

    expect(outcomeFor(outcomes, "owner/forbidden").code).toBe("failed");
    expect(outcomeFor(outcomes, "owner/forbidden").why).toContain("403");
    // The failure came first in the topic listing; the pass did not stop on it.
    expect(outcomeFor(outcomes, "owner/reachable").code).toBe("written");
    // …and the run still reds, because the estate is now on two different stub sets and this run's
    // conclusion is the only thing that can say so.
    expect(exitCodeFor(outcomes)).toBe(1);
  });

  it("distinguishes a repository with no commit yet, which one push fixes, from one it cannot reach", () => {
    const dir = machineWorkflows(["verify"]);
    const wire = createWire({ "owner/blank": { files: [], empty: true } });

    const outcome = outcomeFor(enrol(dir, wire), "owner/blank");

    expect(outcome.code).toBe("skipped");
    expect(outcome.why).toContain("no commit");
    expect(writeCalls(wire.calls)).toEqual([]);
  });
});

describe("the machine itself", () => {
  it("is skipped even when it carries the topic, rather than enrolled into itself", () => {
    const dir = machineWorkflows(["verify"]);
    const wire = createWire({ "owner/machine": { files: [] } });

    const outcome = outcomeFor(enrol(dir, wire), "owner/machine");

    expect(outcome.code).toBe("skipped");
    expect(wire.calls.filter((argv) => (argv[1] ?? "").startsWith("repos/"))).toEqual([]);
  });
});

describe("an empty stub set", () => {
  it("refuses the pass rather than deleting every stub in every enrolled repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "enrol-empty-"));
    const wire = createWire({ "owner/target": { files: [] } });

    expect(() => enrol(dir, wire)).toThrow(/would.*delete every stub/s);
    expect(wire.calls).toEqual([]);
  });
});
