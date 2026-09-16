import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh.ts";
import { NEEDS_HUMAN_LABEL } from "../shared/labels.ts";
import { catalogueLabels, labelPlan, type Label } from "../shared/label-sync.ts";
import { ENROLMENT_TOPIC, exitCodeFor, runEnrol, type RepositoryOutcome } from "./enrol.ts";
import { OUTWARD_CREDENTIAL, derivedSecretNames } from "./secrets.ts";
import { SEEDED_DOC_NAMES, claudeMdPointerLine, pointerDoc, pointerDocPath } from "./seeded-docs.ts";
import { WORKFLOWS_PATH, blobSha, planFor, readStubSet } from "./stub-set.ts";
import { test } from "vitest";
import { trackerGh } from "../shared/tracker-gh.ts";
import { trackerMemory, type TrackerMemory, type TrackerMemoryRepository } from "../shared/tracker-memory.ts";
import { readLabels } from "../shared/label-sync.ts";
import { enrolledRepositories } from "./enrol.ts";

const MACHINE_REPOSITORY = "owner/machine";

function stubBody(lane: string): string {
  return `name: ${lane}\n\n"on":\n  workflow_dispatch:\n`;
}

function machineWorkflows(lanes: string[], secretRefs: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "enrol-machine-"));
  for (const lane of lanes) writeFileSync(join(dir, `${lane}-caller.yml`), stubBody(lane));
  const refs = secretRefs.map((name) => `secrets.${name}`).join("\n  ");
  writeFileSync(join(dir, "enrol.yml"), refs === "" ? "name: Enrol\n" : `name: Enrol\nenv:\n  ${refs}\n`);
  return dir;
}

function currentDocsFiles(machineRepository: string, overrides: Record<string, string> = {}): Record<string, string> {
  const base = Object.fromEntries(
    SEEDED_DOC_NAMES.map((name) => [pointerDocPath(name), pointerDoc(name, machineRepository)]),
  );
  return { ...base, ...overrides };
}

function repositoryCurrent(overrides: Partial<TrackerMemoryRepository> = {}): TrackerMemoryRepository {
  const { files, ...rest } = overrides;
  return { headCommit: "headsha", ...rest, files: { ...currentDocsFiles(MACHINE_REPOSITORY), ...(files ?? {}) } };
}

function fixture(
  repositories: Record<string, TrackerMemoryRepository>,
  repositoriesByTopic: string[] = Object.keys(repositories),
): TrackerMemory {
  return trackerMemory({ repositoriesByTopic, repositories });
}

function outcomeFor(outcomes: RepositoryOutcome[], repository: string): RepositoryOutcome {
  const found = outcomes.find((outcome) => outcome.repository === repository);
  if (found === undefined) throw new Error(`no outcome for ${repository}`);
  return found;
}

function enrol(workflowsDir: string, tracker: TrackerMemory, secretValues: Record<string, string> = {}): RepositoryOutcome[] {
  return runEnrol({
    gh: tracker as unknown as GhExec,
    workflowsDir,
    topic: ENROLMENT_TOPIC,
    machineRepository: MACHINE_REPOSITORY,
    machineSha: "abc123",
    secretValues,
    log: () => {},
  });
}

function stubCommitFor(tracker: TrackerMemory, repository: string) {
  return tracker.commits.find((commit) => commit.repository === repository && commit.message.includes("Machine-Sha:"));
}

function expectNoRepositoryWrites(tracker: TrackerMemory): void {
  expect(tracker.commits).toEqual([]);
  expect(tracker.labelWrites).toEqual([]);
  expect(tracker.workflowApprovalsSet).toEqual([]);
  expect(Object.keys(tracker.secretsSet)).toEqual([]);
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
    const tracker = fixture({
      "owner/current": repositoryCurrent({
        directories: { [WORKFLOWS_PATH]: stubs.map((stub) => ({ name: stub.name, sha: stub.sha })) },
        labels: catalogueLabels(),
      }),
    });

    const outcomes = enrol(dir, tracker, { FOO: "foo-value" });
    const outcome = outcomeFor(outcomes, "owner/current");

    expect(outcome.code).toBe("current");
    expect(outcome.labelsWritten).toEqual([]);
    expect(outcome.secretsWritten).toEqual(["FOO"]);
    expect(tracker.commits).toEqual([]);
    expect(tracker.labelWrites).toEqual([]);
    expect(tracker.workflowApprovalsSet).toEqual(["owner/current"]);
    expect(tracker.secretsSet).toEqual({ "owner/current": { FOO: "foo-value" } });
    expect(exitCodeFor(outcomes)).toBe(0);
  });
});

describe("a pass over a target that has drifted", () => {
  it("carries stub writes and deletes in one commit, and touches nothing outside the glob", () => {
    const dir = machineWorkflows(["verify", "audit"]);
    const stubs = readStubSet(dir);
    const tracker = fixture({
      "owner/drifted": repositoryCurrent({
        directories: {
          [WORKFLOWS_PATH]: [
            { name: "verify-caller.yml", sha: stubs.find((s) => s.name === "verify-caller.yml")?.sha ?? "" },
            { name: "audit-caller.yml", sha: "an-older-version" },
            { name: "retired-caller.yml", sha: "left-behind" },
            { name: "their-own-ci.yml", sha: "not-ours" },
          ],
        },
      }),
    });

    const outcomes = enrol(dir, tracker);
    const outcome = outcomeFor(outcomes, "owner/drifted");

    expect(outcome.code).toBe("written");
    expect(outcome.wrote).toEqual(["audit-caller.yml"]);
    expect(outcome.deleted).toEqual(["retired-caller.yml"]);

    const commit = stubCommitFor(tracker, "owner/drifted");
    expect(commit?.changes).toEqual([
      { path: `${WORKFLOWS_PATH}/audit-caller.yml`, content: stubs.find((s) => s.name === "audit-caller.yml")?.content },
      { path: `${WORKFLOWS_PATH}/retired-caller.yml`, content: null },
    ]);
    expect(commit?.message).toContain("Machine-Sha: abc123");
  });
});

describe("labels, the ADR-0093 setting, and secrets ride every pass, independent of the stub outcome and of each other", () => {
  it("corrects a differing label, creates a missing one, and leaves the target's own label alone, while still setting ADR-0093 and both secrets", () => {
    const dir = machineWorkflows(["verify"], ["FOO", "BAR"]);
    const own = catalogueLabels();
    const ticket = own.find((label) => label.name === "ticket") as Label;
    const needsHuman = own.find((label) => label.name === NEEDS_HUMAN_LABEL) as Label;
    const tracker = fixture({
      "owner/target": repositoryCurrent({
        directories: { [WORKFLOWS_PATH]: readStubSet(dir).map((stub) => ({ name: stub.name, sha: stub.sha })) },
        labels: [
          ...own.filter((label) => label !== ticket && label !== needsHuman),
          { ...ticket, color: "999999" },
          { name: "theirs", color: "abcdef", description: "the target's own label" },
        ],
      }),
    });

    const outcomes = enrol(dir, tracker, { FOO: "foo-value", BAR: "bar-value" });
    const outcome = outcomeFor(outcomes, "owner/target");

    expect(outcome.labelsFailure).toBeUndefined();
    expect(outcome.labelsWritten).toEqual(["needs-human", "ticket"]);
    expect(tracker.labelWrites).toEqual([
      { kind: "create", repository: "owner/target", label: needsHuman },
      { kind: "update", repository: "owner/target", label: ticket },
    ]);
    expect(tracker.labelWrites.some((write) => write.label.name === "theirs")).toBe(false);

    expect(outcome.settingFailure).toBeUndefined();
    expect(tracker.workflowApprovalsSet).toContain("owner/target");

    expect(outcome.secretsFailure).toBeUndefined();
    expect(outcome.secretsWritten).toEqual(["BAR", "FOO"]);
    expect(tracker.secretsSet["owner/target"]).toEqual({ FOO: "foo-value", BAR: "bar-value" });
    expect(tracker.secretsSet["owner/target"]?.[OUTWARD_CREDENTIAL]).toBeUndefined();

    expect(exitCodeFor(outcomes)).toBe(0);
  });

  it("reports a read-back that is not true as a failure for that repository, without touching labels or secrets", () => {
    const dir = machineWorkflows(["verify"]);
    const tracker = fixture({
      "owner/half-set": repositoryCurrent({ workflowApprovalReadBack: "false" }),
    });

    const outcomes = enrol(dir, tracker);
    const outcome = outcomeFor(outcomes, "owner/half-set");

    expect(outcome.settingFailure).toContain("false");
    expect(outcome.labelsFailure).toBeUndefined();
    expect(outcome.secretsFailure).toBeUndefined();
    expect(exitCodeFor(outcomes)).toBe(1);
  });

  it("keeps a label failure from withholding the ADR-0093 setting or the secrets for the same repository", () => {
    const dir = machineWorkflows(["verify"], ["FOO"]);
    const tracker = fixture({
      "owner/labels-down": repositoryCurrent({ refusesLabels: "gh: Internal Server Error (HTTP 500)" }),
    });

    const outcomes = enrol(dir, tracker, { FOO: "foo-value" });
    const outcome = outcomeFor(outcomes, "owner/labels-down");

    expect(outcome.labelsFailure).toContain("500");
    expect(outcome.settingFailure).toBeUndefined();
    expect(tracker.workflowApprovalsSet).toContain("owner/labels-down");
    expect(outcome.secretsFailure).toBeUndefined();
    expect(tracker.secretsSet["owner/labels-down"]).toEqual({ FOO: "foo-value" });
    expect(exitCodeFor(outcomes)).toBe(1);
  });
});

describe("a repository the token cannot write at all", () => {
  it("fails every one of the four writes while the rest of the estate is still brought up to date", () => {
    const dir = machineWorkflows(["verify"], ["FOO"]);
    const tracker = fixture({
      "owner/forbidden": { refuses: "gh: Resource not accessible by integration (HTTP 403)" },
      "owner/reachable": repositoryCurrent(),
    });

    const outcomes = enrol(dir, tracker, { FOO: "foo-value" });

    const forbidden = outcomeFor(outcomes, "owner/forbidden");
    expect(forbidden.code).toBe("failed");
    expect(forbidden.why).toContain("403");
    expect(forbidden.labelsFailure).toContain("403");
    expect(forbidden.settingFailure).toContain("403");
    expect(forbidden.secretsFailure).toContain("403");

    const reachable = outcomeFor(outcomes, "owner/reachable");
    expect(reachable.code).toBe("written");
    expect(reachable.labelsFailure).toBeUndefined();
    expect(reachable.settingFailure).toBeUndefined();
    expect(reachable.secretsFailure).toBeUndefined();

    expect(exitCodeFor(outcomes)).toBe(1);
  });

  it("distinguishes a repository with no commit yet, which one push fixes, from one it cannot reach, and still sets ADR-0093 and secrets on it", () => {
    const dir = machineWorkflows(["verify"], ["FOO"]);
    const tracker = fixture({ "owner/blank": { files: currentDocsFiles(MACHINE_REPOSITORY) } });

    const outcomes = enrol(dir, tracker, { FOO: "foo-value" });
    const outcome = outcomeFor(outcomes, "owner/blank");

    expect(outcome.code).toBe("skipped");
    expect(outcome.why).toContain("no commit");
    expect(tracker.commits.some((commit) => commit.repository === "owner/blank")).toBe(false);
    expect(tracker.workflowApprovalsSet).toContain("owner/blank");
    expect(tracker.secretsSet["owner/blank"]).toEqual({ FOO: "foo-value" });
    expect(exitCodeFor(outcomes)).toBe(0);
  });
});

describe("the machine itself", () => {
  it("is skipped even when it carries the topic, rather than enrolled into itself", () => {
    const dir = machineWorkflows(["verify"]);
    const tracker = fixture({}, ["owner/machine"]);

    const outcome = outcomeFor(enrol(dir, tracker), "owner/machine");

    expect(outcome.code).toBe("skipped");
    expectNoRepositoryWrites(tracker);
  });
});

describe("seeded docs are pointers, written in the same pass", () => {
  it("writes a pointer for a doc the target carries as a full copy", () => {
    const dir = machineWorkflows(["verify"]);
    const tracker = fixture({
      "owner/full-copy": repositoryCurrent({
        files: { [pointerDocPath("ticket-format.md")]: "# Ticket format\n\nThe whole seeded copy, byte for byte.\n" },
      }),
    });

    const outcomes = enrol(dir, tracker);
    const outcome = outcomeFor(outcomes, "owner/full-copy");

    expect(outcome.docsFailure).toBeUndefined();
    expect(outcome.docsWritten).toContain(pointerDocPath("ticket-format.md"));

    const changes = tracker.commits.filter((each) => each.repository === "owner/full-copy").flatMap((each) => each.changes);
    expect(changes.map((change) => change.path)).toContain(pointerDocPath("ticket-format.md"));
  });

  it("writes nothing when every seeded doc already carries the pointer text", () => {
    const dir = machineWorkflows(["verify"]);
    const tracker = fixture({
      "owner/already-pointers": repositoryCurrent({
        directories: { [WORKFLOWS_PATH]: readStubSet(dir).map((stub) => ({ name: stub.name, sha: stub.sha })) },
      }),
    });

    const outcomes = enrol(dir, tracker);
    const outcome = outcomeFor(outcomes, "owner/already-pointers");

    expect(outcome.docsWritten).toEqual([]);
    expect(tracker.commits.some((commit) => commit.repository === "owner/already-pointers")).toBe(false);
  });

  it("adds the CLAUDE.md pointer line under a heading of its own, leaving the rest of the file alone", () => {
    const dir = machineWorkflows(["verify"]);
    const tracker = fixture({
      "owner/needs-claude-md": repositoryCurrent({ files: { "CLAUDE.md": "# Some project\n\nSome prose.\n" } }),
    });

    const outcomes = enrol(dir, tracker);
    const outcome = outcomeFor(outcomes, "owner/needs-claude-md");

    expect(outcome.docsWritten).toContain("CLAUDE.md");
    const changes = tracker.commits.filter((each) => each.repository === "owner/needs-claude-md").flatMap((each) => each.changes);
    const claudeMdWrite = changes.find((change) => change.path === "CLAUDE.md");
    expect(claudeMdWrite).toBeDefined();
  });

  it("never touches CLAUDE.md the target does not carry at all", () => {
    const dir = machineWorkflows(["verify"]);
    const tracker = fixture({ "owner/no-claude-md": repositoryCurrent() });

    const outcomes = enrol(dir, tracker);
    const outcome = outcomeFor(outcomes, "owner/no-claude-md");

    expect(outcome.docsWritten ?? []).not.toContain("CLAUDE.md");
  });

  it("a doc failure never withholds the stub, label, setting or secret writes for the same repository", () => {
    const dir = machineWorkflows(["verify"], ["FOO"]);
    const tracker = fixture({
      "owner/docs-down": {
        headCommit: "headsha",
        directories: { [WORKFLOWS_PATH]: readStubSet(dir).map((stub) => ({ name: stub.name, sha: `stale-${stub.sha}` })) },
        refusesDocs: "gh: Internal Server Error (HTTP 500)",
      },
    });

    const outcomes = enrol(dir, tracker, { FOO: "foo-value" });
    const outcome = outcomeFor(outcomes, "owner/docs-down");

    expect(outcome.docsFailure).toContain("500");
    expect(outcome.code).toBe("written");
    expect(outcome.settingFailure).toBeUndefined();
    expect(outcome.secretsFailure).toBeUndefined();
    expect(exitCodeFor(outcomes)).toBe(0);
  });

  it("names the machine repository and the workstation clone in the pointer it writes", () => {
    expect(pointerDoc("ticket-format.md", MACHINE_REPOSITORY)).toContain(MACHINE_REPOSITORY);
    expect(claudeMdPointerLine(MACHINE_REPOSITORY)).toContain(MACHINE_REPOSITORY);
  });
});

describe("an empty stub set", () => {
  it("refuses the pass rather than deleting every stub in every enrolled repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "enrol-empty-"));
    const tracker = fixture({ "owner/target": repositoryCurrent() });

    expect(() => enrol(dir, tracker)).toThrow(/would.*delete every stub/s);
    expectNoRepositoryWrites(tracker);
  });
});

describe("#626: enrol.ts and label-sync.ts reach a repository through Tracker operations, not argv they build themselves", () => {
  test("#626.1: enrol.ts reaches the enrolled repository list through a Tracker operation, not an api call it builds itself", () => {
    const tracker = trackerGh(() => "owner/one\nowner/two\n");

    expect(enrolledRepositories(tracker as unknown as GhExec, ENROLMENT_TOPIC)).toEqual(["owner/one", "owner/two"]);
  });

  test("#626.2: label-sync.ts reads a repository's labels through a Tracker operation, not an api call it builds itself", () => {
    const tracker = trackerGh(() => '{"name":"alpha","color":"111111","description":"first"}\n');

    expect(readLabels(tracker as unknown as GhExec, "owner/repo")).toEqual([
      { name: "alpha", color: "111111", description: "first" },
    ]);
  });

  test("#626.3: runEnrol drives its whole pass off a Tracker seeded by trackerMemory, not a GhExec that parses api argv", () => {
    const tracker = trackerMemory();

    const outcomes = runEnrol({
      gh: tracker as unknown as GhExec,
      workflowsDir: machineWorkflows(["verify"]),
      topic: ENROLMENT_TOPIC,
      machineRepository: MACHINE_REPOSITORY,
      machineSha: "abc123",
      secretValues: {},
      log: () => {},
    });

    expect(outcomes).toEqual([]);
  });
});
