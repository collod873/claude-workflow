import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { createFakeStage } from "../shared/stage.fake";
import { runProposedAuditor, type ProposedAuditorOptions } from "./auditor";
import { applyTwoSiteGate, parseProposedFindings, proposedPrompt } from "./lenses/proposed";
import { violationPrompt } from "./lenses/violation";

/**
 * Every test in this file runs the auditor through `createFakeGit` and
 * `createFakeStage` — no test here ever spawns the real `git` or `claude`
 * binaries. Mirrors `auditor.test.ts`'s `baseOptions`, minus `standards`
 * (PROPOSED doesn't take one — see `ProposedAuditorOptions`).
 */
function baseOptions(overrides: Partial<ProposedAuditorOptions> = {}): ProposedAuditorOptions {
  const fakeGit = createFakeGit(() => "+ a diff line");
  const fakeStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
  return {
    git: fakeGit.git,
    exec: fakeStage.exec,
    repoDir: "/repo",
    base: "abc123",
    head: "def456",
    touchedPaths: ["a.ts"],
    spine: "the session's own spine",
    ...overrides,
  };
}

describe("runProposedAuditor / the two-site gate", () => {
  it("records a single-site finding as not released", () => {
    const fakeStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const result = runProposedAuditor(baseOptions({ exec: fakeStage.exec }));

    expect(result).toEqual([{ finding: "duplicated validation logic", sites: ["a.ts:10"], released: false }]);
  });

  it("flips a finding to released once a second fixture run names a second site for it", () => {
    const firstStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const firstRun = runProposedAuditor(baseOptions({ exec: firstStage.exec }));

    expect(firstRun).toEqual([{ finding: "duplicated validation logic", sites: ["a.ts:10"], released: false }]);

    const secondStage = createFakeStage("Finding: duplicated validation logic\nSite: b.ts:22\n");
    const secondRun = runProposedAuditor(baseOptions({ exec: secondStage.exec, priorFindings: firstRun }));

    expect(secondRun).toEqual([
      { finding: "duplicated validation logic", sites: ["a.ts:10", "b.ts:22"], released: true },
    ]);
  });

  it("does not double-count the same site named again in a later run", () => {
    const firstStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const firstRun = runProposedAuditor(baseOptions({ exec: firstStage.exec }));

    const secondStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const secondRun = runProposedAuditor(baseOptions({ exec: secondStage.exec, priorFindings: firstRun }));

    expect(secondRun).toEqual([{ finding: "duplicated validation logic", sites: ["a.ts:10"], released: false }]);
  });

  it("tracks unrelated findings independently", () => {
    const firstStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const firstRun = runProposedAuditor(baseOptions({ exec: firstStage.exec }));

    const secondStage = createFakeStage("Finding: a different pattern entirely\nSite: c.ts:1\n");
    const secondRun = runProposedAuditor(baseOptions({ exec: secondStage.exec, priorFindings: firstRun }));

    expect(secondRun).toEqual([
      { finding: "duplicated validation logic", sites: ["a.ts:10"], released: false },
      { finding: "a different pattern entirely", sites: ["c.ts:1"], released: false },
    ]);
  });

  it("threads repoDir, base, head, and touchedPaths to the git executor via sessionRangeDiff, and reuses VIOLATION's sandbox flags unchanged", () => {
    const fakeGit = createFakeGit(() => "");
    const fakeStage = createFakeStage("no pattern worth proposing");
    const options = baseOptions({
      git: fakeGit.git,
      exec: fakeStage.exec,
      repoDir: "/some/repo",
      base: "abc",
      head: "def",
      touchedPaths: ["x.ts"],
    });

    runProposedAuditor(options);

    expect(fakeGit.calls).toHaveLength(1);
    expect(fakeGit.calls[0]).toEqual(["-C", "/some/repo", "diff", "--no-color", "abc", "def", "--", "x.ts"]);

    expect(fakeStage.calls).toHaveLength(1);
    const [argv] = fakeStage.calls;
    expect(argv[0]).toBe("-p");
    expect(argv.slice(2)).toEqual([
      "--model",
      "sonnet",
      "--output-format",
      "text",
      "--no-session-persistence",
      "--tools",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--setting-sources",
      "",
    ]);
  });

  it("returns no findings when the raw text carries no Finding/Site pair, an empty pass", () => {
    const fakeStage = createFakeStage("No pattern worth proposing here. Empty pass.");
    const result = runProposedAuditor(baseOptions({ exec: fakeStage.exec }));

    expect(result).toEqual([]);
  });
});

describe('the "Suggested CODING_STANDARDS.md line:" field', () => {
  const forbidden = "Suggested CODING_STANDARDS.md line:";

  it("never appears in the PROPOSED prompt, for every fixture case in this file", () => {
    const cases = [
      { diff: "+ export const mine = 1;", spine: "session did X" },
      { diff: "", spine: "" },
      { diff: "+ duplicated validation logic twice", spine: "a refactor session" },
    ];

    for (const proposedCase of cases) {
      expect(proposedPrompt(proposedCase)).not.toContain(forbidden);
    }
  });

  it("never appears in the VIOLATION prompt, for every fixture case in this file", () => {
    const cases = [
      { standards: "entry: never do Y", diff: "+ export const mine = 1;", spine: "session did X" },
      { standards: "", diff: "", spine: "" },
    ];

    for (const violationCase of cases) {
      expect(violationPrompt(violationCase)).not.toContain(forbidden);
    }
  });

  it("never survives into a parsed PROPOSED finding, even when the model's raw output includes the field", () => {
    const raw = [
      "Finding: duplicated validation logic",
      "Site: a.ts:10",
      `${forbidden} never do Y`,
      "",
      "Finding: another pattern",
      "Site: b.ts:5",
    ].join("\n");

    const findings = parseProposedFindings(raw);

    expect(findings).toEqual([
      { finding: "duplicated validation logic", site: "a.ts:10" },
      { finding: "another pattern", site: "b.ts:5" },
    ]);
    for (const finding of findings) {
      expect(finding.finding).not.toContain(forbidden);
      expect(finding.site).not.toContain(forbidden);
    }
  });

  it("never survives into a gated PROPOSED finding returned by the auditor, across single- and two-site runs", () => {
    const rawWithField = [
      "Finding: duplicated validation logic",
      "Site: a.ts:10",
      `${forbidden} never repeat a null check`,
    ].join("\n");
    const firstStage = createFakeStage(rawWithField);
    const firstRun = runProposedAuditor(baseOptions({ exec: firstStage.exec }));

    const secondStage = createFakeStage(
      ["Finding: duplicated validation logic", "Site: b.ts:22", `${forbidden} still never repeat it`].join("\n"),
    );
    const secondRun = runProposedAuditor(baseOptions({ exec: secondStage.exec, priorFindings: firstRun }));

    for (const run of [firstRun, secondRun]) {
      for (const gated of run) {
        expect(gated.finding).not.toContain(forbidden);
        for (const site of gated.sites) expect(site).not.toContain(forbidden);
      }
    }
    expect(secondRun).toEqual([
      { finding: "duplicated validation logic", sites: ["a.ts:10", "b.ts:22"], released: true },
    ]);
  });
});

describe("applyTwoSiteGate", () => {
  it("starts a new finding unreleased on its first site", () => {
    expect(applyTwoSiteGate([], [{ finding: "f", site: "a.ts:1" }])).toEqual([
      { finding: "f", sites: ["a.ts:1"], released: false },
    ]);
  });

  it("releases a finding the moment a second distinct site is folded in", () => {
    const afterFirst = applyTwoSiteGate([], [{ finding: "f", site: "a.ts:1" }]);
    const afterSecond = applyTwoSiteGate(afterFirst, [{ finding: "f", site: "b.ts:2" }]);

    expect(afterSecond).toEqual([{ finding: "f", sites: ["a.ts:1", "b.ts:2"], released: true }]);
  });
});
