import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh.ts";
import { ENROLMENT_TOPIC, exitCodeFor, runEnrol, type RepositoryOutcome } from "./enrol.ts";
import { labelPlan, type Label } from "./labels.ts";
import { OUTWARD_CREDENTIAL, derivedSecretNames } from "./secrets.ts";
import { blobSha, planFor, readStubSet, type RemoteFile } from "./stub-set.ts";

/**
 * The enrol lane, asserted against a stand-in GitHub (#326, #327). Every write this lane makes
 * lands in somebody else's repository, so "it wrote nothing" is the property that most needs
 * proving and the one a live test could never prove safely — the fake records every argv, and a
 * quiet run is a run whose recording holds no write.
 */

const MACHINE_REPOSITORY = "owner/machine";

/** A caller stub's bytes. The content is arbitrary; only its identity across the wire matters. */
function stubBody(lane: string): string {
  return `name: ${lane}\n\n"on":\n  workflow_dispatch:\n`;
}

/**
 * A throwaway `.github/workflows` holding the named stubs, plus one workflow that is not a stub —
 * and, when given, one more file carrying arbitrary `secrets.<NAME>` references, standing in for
 * a reusable workflow that spends a secret.
 */
function machineWorkflows(lanes: string[], secretRefs: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "enrol-machine-"));
  for (const lane of lanes) writeFileSync(join(dir, `${lane}-caller.yml`), stubBody(lane));
  // The enrol lane itself: a workflow with no caller, which is how it stays out of its own output.
  const refs = secretRefs.map((name) => `secrets.${name}`).join("\n  ");
  writeFileSync(join(dir, "enrol.yml"), refs === "" ? "name: Enrol\n" : `name: Enrol\nenv:\n  ${refs}\n`);
  return dir;
}

interface FakeRepo {
  /** What `.github/workflows` holds, as the contents API would list it. */
  files: RemoteFile[];
  /** What the repository's labels are, as the labels API would list it. Defaults to none. */
  labels?: Label[];
  /** What a read-back of the ADR-0093 setting reports. Defaults to `"true"` — already correct. */
  settingReadBack?: string;
  /** When set, every call touching this repository throws with this message. */
  refuses?: string;
  /** When set, only this repository's label reads/writes throw with this message. */
  refusesLabels?: string;
  /** When set, only this repository's ADR-0093 `PUT`/read-back throws with this message. */
  refusesSetting?: string;
  /** When set, only this repository's secret writes throw with this message. */
  refusesSecrets?: string;
  /** When true, the repository has no commit on its default branch. */
  empty?: boolean;
}

/** One label write this fake recorded — a create (no prior label of that name) or a correction. */
interface LabelWrite {
  kind: "create" | "update";
  name: string;
  color: string;
  description: string;
}

interface Wire {
  gh: GhExec;
  calls: string[][];
  /** Every git tree this fake was asked to create, by repository, already parsed. */
  trees: Map<string, Array<{ path: string; sha: string | null }>>;
  /** Every commit message this fake was asked to write, by repository. */
  messages: Map<string, string>;
  /** Every label create/update this fake recorded, by repository, in call order. */
  labelWrites: Map<string, LabelWrite[]>;
  /** Every repository whose ADR-0093 setting this fake was asked to `PUT`. */
  settingPut: Set<string>;
  /** Every secret this fake was asked to set, by repository, name to value. */
  secretsSet: Map<string, Record<string, string>>;
}

/** The `--method X` value in a `gh api` argv, or `undefined` for a plain `GET`. */
function methodOf(args: string[]): string | undefined {
  const at = args.indexOf("--method");
  return at === -1 ? undefined : args[at + 1];
}

/** Every `-f`/`-F key=value` pair in a `gh api` argv, collapsed to a plain object. */
function fieldsOf(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let at = 0; at < args.length; at++) {
    if ((args[at] === "-f" || args[at] === "-F") && args[at + 1] !== undefined) {
      const pair = args[at + 1];
      const eq = pair.indexOf("=");
      out[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return out;
}

function labelLines(labels: Label[]): string {
  return labels.length === 0 ? "" : `${labels.map((label) => JSON.stringify(label)).join("\n")}\n`;
}

/** Enough of GitHub for one enrolment pass: search, contents, labels, the ADR-0093 setting, secrets, and the git data API. */
function createWire(repos: Record<string, FakeRepo>, ownLabels: Label[] = []): Wire {
  const calls: string[][] = [];
  const trees = new Map<string, Array<{ path: string; sha: string | null }>>();
  const messages = new Map<string, string>();
  const labelWrites = new Map<string, LabelWrite[]>();
  const settingPut = new Set<string>();
  const secretsSet = new Map<string, Record<string, string>>();

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

    if (args[0] === "secret" && args[1] === "set") {
      const name = args[2];
      const repository = args[args.indexOf("-R") + 1];
      const value = args[args.indexOf("--body") + 1];
      const repo = repos[repository];
      if (repo === undefined) throw new Error(`fake gh: no repository ${repository}`);
      if (repo.refuses) throw new Error(repo.refuses);
      if (repo.refusesSecrets) throw new Error(repo.refusesSecrets);
      const set = secretsSet.get(repository) ?? {};
      set[name] = value;
      secretsSet.set(repository, set);
      return "";
    }

    const path = pathIn(args);

    if (path.startsWith("search/repositories")) {
      expect(path).toContain(`topic:${ENROLMENT_TOPIC}`);
      return `${Object.keys(repos).join("\n")}\n`;
    }

    if (path === `repos/${MACHINE_REPOSITORY}/labels`) {
      return labelLines(ownLabels);
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

    if (path === `repos/${name}/labels`) {
      if (repo.refusesLabels) throw new Error(repo.refusesLabels);
      if (methodOf(args) === "POST") {
        const fields = fieldsOf(args);
        const list = labelWrites.get(name) ?? [];
        list.push({ kind: "create", name: fields.name, color: fields.color, description: fields.description });
        labelWrites.set(name, list);
        return "";
      }
      return labelLines(repo.labels ?? []);
    }

    if (path.startsWith(`repos/${name}/labels/`)) {
      if (repo.refusesLabels) throw new Error(repo.refusesLabels);
      const fields = fieldsOf(args);
      const labelName = decodeURIComponent(path.slice(`repos/${name}/labels/`.length));
      const list = labelWrites.get(name) ?? [];
      list.push({ kind: "update", name: labelName, color: fields.color, description: fields.description });
      labelWrites.set(name, list);
      return "";
    }

    if (path === `repos/${name}/actions/permissions/workflow`) {
      if (repo.refusesSetting) throw new Error(repo.refusesSetting);
      if (methodOf(args) === "PUT") {
        settingPut.add(name);
        return "";
      }
      return `${repo.settingReadBack ?? "true"}\n`;
    }

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, trees, messages, labelWrites, settingPut, secretsSet };
}

function outcomeFor(outcomes: RepositoryOutcome[], repository: string): RepositoryOutcome {
  const found = outcomes.find((outcome) => outcome.repository === repository);
  if (found === undefined) throw new Error(`no outcome for ${repository}`);
  return found;
}

function enrol(workflowsDir: string, wire: Wire, secretValues: Record<string, string> = {}): RepositoryOutcome[] {
  return runEnrol({
    gh: wire.gh,
    workflowsDir,
    topic: ENROLMENT_TOPIC,
    machineRepository: MACHINE_REPOSITORY,
    machineSha: "abc123",
    secretValues,
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

describe("the label set is a diff, and a boundary", () => {
  const own: Label[] = [
    { name: "alpha", color: "111111", description: "first" },
    { name: "beta", color: "222222", description: "second" },
  ];

  it("proposes nothing when the target already matches", () => {
    expect(labelPlan(own, own)).toEqual([]);
  });

  it("proposes a correction, not a create, when a name matches but the color or description differs", () => {
    const target: Label[] = [
      { name: "alpha", color: "999999", description: "first" },
      { name: "beta", color: "222222", description: "second" },
    ];

    const plan = labelPlan(own, target);

    expect(plan).toEqual([{ label: own[0], exists: true }]);
  });

  it("proposes a create for a name the target does not carry at all", () => {
    const plan = labelPlan(own, [{ name: "beta", color: "222222", description: "second" }]);

    expect(plan).toEqual([{ label: own[0], exists: false }]);
  });

  it("never touches a label the target carries that this repository does not", () => {
    const target: Label[] = [...own, { name: "their-own-label", color: "abcdef", description: "not ours" }];

    expect(labelPlan(own, target)).toEqual([]);
  });
});

describe("the secret set is derived from this repository's own workflow files", () => {
  it("collects every secrets.<NAME> reference, minus GITHUB_TOKEN and the outward credential", () => {
    const dir = machineWorkflows(["verify"], ["FOO", "BAR", "GITHUB_TOKEN", OUTWARD_CREDENTIAL]);

    expect(derivedSecretNames(dir)).toEqual(["BAR", "FOO"]);
  });

  it("never proposes the outward credential itself, however this lane is called", () => {
    const dir = machineWorkflows(["verify"], [OUTWARD_CREDENTIAL]);

    expect(derivedSecretNames(dir)).toEqual([]);
  });
});

describe("a pass over a target that is already current", () => {
  it("writes no stub commit and no label, but still sets ADR-0093's setting and propagates secrets", () => {
    const dir = machineWorkflows(["verify", "audit"], ["FOO"]);
    const stubs = readStubSet(dir);
    const own: Label[] = [{ name: "alpha", color: "111111", description: "first" }];
    const wire = createWire(
      {
        "owner/current": {
          files: stubs.map((stub) => ({ name: stub.name, sha: stub.sha })),
          labels: own,
        },
      },
      own,
    );

    const outcomes = enrol(dir, wire, { FOO: "foo-value" });
    const outcome = outcomeFor(outcomes, "owner/current");

    expect(outcome.code).toBe("current");
    expect(outcome.labelsWritten).toEqual([]);
    expect(outcome.secretsWritten).toEqual(["FOO"]);
    expect(wire.trees.has("owner/current")).toBe(false);
    expect(wire.messages.has("owner/current")).toBe(false);
    expect(wire.labelWrites.get("owner/current") ?? []).toEqual([]);
    expect(wire.settingPut.has("owner/current")).toBe(true);
    expect(wire.secretsSet.get("owner/current")).toEqual({ FOO: "foo-value" });
    expect(exitCodeFor(outcomes)).toBe(0);
  });
});

describe("a pass over a target that has drifted", () => {
  it("carries stub writes and deletes in one commit, and touches nothing outside the glob", () => {
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

describe("labels, the ADR-0093 setting, and secrets ride every pass, independent of the stub outcome and of each other", () => {
  it("corrects a differing label, creates a missing one, and leaves the target's own label alone — while still setting ADR-0093 and both secrets", () => {
    const dir = machineWorkflows(["verify"], ["FOO", "BAR"]);
    const own: Label[] = [
      { name: "ticket", color: "111111", description: "kind: ticket" },
      { name: "needs-human", color: "222222", description: "an agent stopped" },
    ];
    const wire = createWire(
      {
        "owner/target": {
          files: readStubSet(dir).map((stub) => ({ name: stub.name, sha: stub.sha })),
          labels: [
            { name: "ticket", color: "999999", description: "kind: ticket" },
            { name: "bug", color: "abcdef", description: "GitHub's own stock label" },
          ],
        },
      },
      own,
    );

    const outcomes = enrol(dir, wire, { FOO: "foo-value", BAR: "bar-value" });
    const outcome = outcomeFor(outcomes, "owner/target");

    expect(outcome.labelsFailure).toBeUndefined();
    expect(outcome.labelsWritten).toEqual(["ticket", "needs-human"]);
    expect(wire.labelWrites.get("owner/target")).toEqual([
      { kind: "update", name: "ticket", color: "111111", description: "kind: ticket" },
      { kind: "create", name: "needs-human", color: "222222", description: "an agent stopped" },
    ]);
    // "bug" is the target's own — never named in any label write this pass made.
    expect(wire.labelWrites.get("owner/target")?.some((write) => write.name === "bug")).toBe(false);

    expect(outcome.settingFailure).toBeUndefined();
    expect(wire.settingPut.has("owner/target")).toBe(true);

    expect(outcome.secretsFailure).toBeUndefined();
    expect(outcome.secretsWritten).toEqual(["BAR", "FOO"]);
    expect(wire.secretsSet.get("owner/target")).toEqual({ FOO: "foo-value", BAR: "bar-value" });
    // The outward credential is never among what a target receives, however this pass is called.
    expect(wire.secretsSet.get("owner/target")?.[OUTWARD_CREDENTIAL]).toBeUndefined();

    expect(exitCodeFor(outcomes)).toBe(0);
  });

  it("reports a read-back that is not true as a failure for that repository, without touching labels or secrets", () => {
    const dir = machineWorkflows(["verify"]);
    const wire = createWire({
      "owner/half-set": { files: [], settingReadBack: "false" },
    });

    const outcomes = enrol(dir, wire);
    const outcome = outcomeFor(outcomes, "owner/half-set");

    expect(outcome.settingFailure).toContain("false");
    expect(outcome.labelsFailure).toBeUndefined();
    expect(outcome.secretsFailure).toBeUndefined();
    expect(exitCodeFor(outcomes)).toBe(1);
  });

  it("keeps a label failure from withholding the ADR-0093 setting or the secrets for the same repository", () => {
    const dir = machineWorkflows(["verify"], ["FOO"]);
    const wire = createWire({
      "owner/labels-down": { files: [], refusesLabels: "gh: Internal Server Error (HTTP 500)" },
    });

    const outcomes = enrol(dir, wire, { FOO: "foo-value" });
    const outcome = outcomeFor(outcomes, "owner/labels-down");

    expect(outcome.labelsFailure).toContain("500");
    expect(outcome.settingFailure).toBeUndefined();
    expect(wire.settingPut.has("owner/labels-down")).toBe(true);
    expect(outcome.secretsFailure).toBeUndefined();
    expect(wire.secretsSet.get("owner/labels-down")).toEqual({ FOO: "foo-value" });
    expect(exitCodeFor(outcomes)).toBe(1);
  });
});

describe("a repository the token cannot write at all", () => {
  it("fails every one of the four writes while the rest of the estate is still brought up to date", () => {
    const dir = machineWorkflows(["verify"], ["FOO"]);
    const wire = createWire({
      "owner/forbidden": { files: [], refuses: "gh: Resource not accessible by integration (HTTP 403)" },
      "owner/reachable": { files: [] },
    });

    const outcomes = enrol(dir, wire, { FOO: "foo-value" });

    const forbidden = outcomeFor(outcomes, "owner/forbidden");
    expect(forbidden.code).toBe("failed");
    expect(forbidden.why).toContain("403");
    expect(forbidden.labelsFailure).toContain("403");
    expect(forbidden.settingFailure).toContain("403");
    expect(forbidden.secretsFailure).toContain("403");

    // The failure came first in the topic listing; the pass did not stop on it.
    const reachable = outcomeFor(outcomes, "owner/reachable");
    expect(reachable.code).toBe("written");
    expect(reachable.labelsFailure).toBeUndefined();
    expect(reachable.settingFailure).toBeUndefined();
    expect(reachable.secretsFailure).toBeUndefined();

    // …and the run still reds, because the estate is now on two different stub sets and this run's
    // conclusion is the only thing that can say so.
    expect(exitCodeFor(outcomes)).toBe(1);
  });

  it("distinguishes a repository with no commit yet, which one push fixes, from one it cannot reach — and still sets ADR-0093 and secrets on it", () => {
    const dir = machineWorkflows(["verify"], ["FOO"]);
    const wire = createWire({ "owner/blank": { files: [], empty: true } });

    const outcomes = enrol(dir, wire, { FOO: "foo-value" });
    const outcome = outcomeFor(outcomes, "owner/blank");

    expect(outcome.code).toBe("skipped");
    expect(outcome.why).toContain("no commit");
    expect(wire.trees.has("owner/blank")).toBe(false);
    expect(wire.settingPut.has("owner/blank")).toBe(true);
    expect(wire.secretsSet.get("owner/blank")).toEqual({ FOO: "foo-value" });
    expect(exitCodeFor(outcomes)).toBe(0);
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
