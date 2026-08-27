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
  it("records a single-site finding as not released", async () => {
    const fakeStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const result = await runProposedAuditor(baseOptions({ exec: fakeStage.exec }));

    expect(result).toEqual([{ finding: "duplicated validation logic", sites: ["a.ts:10"], released: false }]);
  });

  it("flips a finding to released once a second fixture run names a second site for it", async () => {
    const firstStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const firstRun = await runProposedAuditor(baseOptions({ exec: firstStage.exec }));

    expect(firstRun).toEqual([{ finding: "duplicated validation logic", sites: ["a.ts:10"], released: false }]);

    const secondStage = createFakeStage("Finding: duplicated validation logic\nSite: b.ts:22\n");
    const secondRun = await runProposedAuditor(baseOptions({ exec: secondStage.exec, priorFindings: firstRun }));

    expect(secondRun).toEqual([
      { finding: "duplicated validation logic", sites: ["a.ts:10", "b.ts:22"], released: true },
    ]);
  });

  it("does not double-count the same site named again in a later run", async () => {
    const firstStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const firstRun = await runProposedAuditor(baseOptions({ exec: firstStage.exec }));

    const secondStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const secondRun = await runProposedAuditor(baseOptions({ exec: secondStage.exec, priorFindings: firstRun }));

    expect(secondRun).toEqual([{ finding: "duplicated validation logic", sites: ["a.ts:10"], released: false }]);
  });

  it("tracks unrelated findings independently", async () => {
    const firstStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:10\n");
    const firstRun = await runProposedAuditor(baseOptions({ exec: firstStage.exec }));

    const secondStage = createFakeStage("Finding: a different pattern entirely\nSite: c.ts:1\n");
    const secondRun = await runProposedAuditor(baseOptions({ exec: secondStage.exec, priorFindings: firstRun }));

    expect(secondRun).toEqual([
      { finding: "duplicated validation logic", sites: ["a.ts:10"], released: false },
      { finding: "a different pattern entirely", sites: ["c.ts:1"], released: false },
    ]);
  });

  it("threads repoDir, base, head, and touchedPaths to the git executor via sessionRangeDiff, and reuses VIOLATION's sandbox flags unchanged", async () => {
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

    await runProposedAuditor(options);

    expect(fakeGit.calls).toHaveLength(1);
    expect(fakeGit.calls[0]).toEqual(["-C", "/some/repo", "diff", "--no-color", "abc", "def", "--", "x.ts"]);

    expect(fakeStage.calls).toHaveLength(1);
    const [argv] = fakeStage.calls;
    expect(argv[0]).toBe("-p");
    expect(argv.slice(1)).toEqual([
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

  it("returns no findings when the raw text carries no Finding/Site pair, an empty pass", async () => {
    const fakeStage = createFakeStage("No pattern worth proposing here. Empty pass.");
    const result = await runProposedAuditor(baseOptions({ exec: fakeStage.exec }));

    expect(result).toEqual([]);
  });
});

describe('the "Suggested CODING_STANDARDS.md line:" field', () => {
  const forbidden = "Suggested CODING_STANDARDS.md line:";

  it("never appears in the PROPOSED prompt, for every fixture case in this file", async () => {
    const cases = [
      { diff: "+ export const mine = 1;", spine: "session did X" },
      { diff: "", spine: "" },
      { diff: "+ duplicated validation logic twice", spine: "a refactor session" },
    ];

    for (const proposedCase of cases) {
      expect(proposedPrompt(proposedCase)).not.toContain(forbidden);
    }
  });

  it("never appears in the VIOLATION prompt, for every fixture case in this file", async () => {
    const cases = [
      { standards: "entry: never do Y", diff: "+ export const mine = 1;", spine: "session did X" },
      { standards: "", diff: "", spine: "" },
    ];

    for (const violationCase of cases) {
      expect(violationPrompt(violationCase)).not.toContain(forbidden);
    }
  });

  it("never survives into a parsed PROPOSED finding, even when the model's raw output includes the field", async () => {
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

  it("never survives into a gated PROPOSED finding returned by the auditor, across single- and two-site runs", async () => {
    const rawWithField = [
      "Finding: duplicated validation logic",
      "Site: a.ts:10",
      `${forbidden} never repeat a null check`,
    ].join("\n");
    const firstStage = createFakeStage(rawWithField);
    const firstRun = await runProposedAuditor(baseOptions({ exec: firstStage.exec }));

    const secondStage = createFakeStage(
      ["Finding: duplicated validation logic", "Site: b.ts:22", `${forbidden} still never repeat it`].join("\n"),
    );
    const secondRun = await runProposedAuditor(baseOptions({ exec: secondStage.exec, priorFindings: firstRun }));

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
  it("starts a new finding unreleased on its first site", async () => {
    expect(applyTwoSiteGate([], [{ finding: "f", site: "a.ts:1" }])).toEqual([
      { finding: "f", sites: ["a.ts:1"], released: false },
    ]);
  });

  it("releases a finding the moment a second distinct site is folded in", async () => {
    const afterFirst = applyTwoSiteGate([], [{ finding: "f", site: "a.ts:1" }]);
    const afterSecond = applyTwoSiteGate(afterFirst, [{ finding: "f", site: "b.ts:2" }]);

    expect(afterSecond).toEqual([{ finding: "f", sites: ["a.ts:1", "b.ts:2"], released: true }]);
  });

  it("reads a prior note's prose site and this run's bare one as the same sighting, not two", async () => {
    // What `refs/notes/observations` actually carries from run 32996383308 (#108) — if these
    // read as two distinct sites, a pattern seen once clears the gate.
    const prior = [{ finding: "f", sites: ["a.ts:1 (theFunction)"], released: false }];

    const merged = applyTwoSiteGate(prior, [{ finding: "f", site: "a.ts:1" }]);

    expect(merged).toEqual([{ finding: "f", sites: ["a.ts:1"], released: false }]);
  });

  it("collapses a prior note's several spellings of one site into the one site they name", async () => {
    const prior = [{ finding: "f", sites: ["a.ts:1 (theFunction)", "a.ts:1 (still the same line)"], released: true }];

    const merged = applyTwoSiteGate(prior, []);

    expect(merged).toEqual([{ finding: "f", sites: ["a.ts:1"], released: false }]);
  });
});

describe("the site contract, against the lens that writes one", () => {
  it("narrows a PROPOSED site to a path and line, whatever the model hangs off it", async () => {
    // Verbatim from run 32996383308's own note — the shape the lens emits when told `file:line`.
    const raw = [
      "Finding: scratch-project detection duplicated",
      "Site: .Workflow/agent-workflows/capture/backfill.ts:212 (isScratchProject)",
      "",
      "Finding: module header drifts from the code under it",
      "Site: .Workflow/agent-workflows/shared/spine.ts (quoted/bulleted functions, ~line 233)",
    ].join("\n");

    expect(parseProposedFindings(raw)).toEqual([
      {
        finding: "scratch-project detection duplicated",
        site: ".Workflow/agent-workflows/capture/backfill.ts:212",
      },
      {
        finding: "module header drifts from the code under it",
        site: ".Workflow/agent-workflows/shared/spine.ts",
      },
    ]);
  });

  it("tells the model the site carries nothing past the line number, in both lenses' prompts", async () => {
    const proposed = proposedPrompt({ diff: "+ a line", spine: "the spine" });
    const violation = violationPrompt({ standards: "entry: never do Y", diff: "+ a line", spine: "the spine" });

    for (const prompt of [proposed, violation]) {
      expect(prompt).toContain("a path and a line number, nothing else");
    }
  });

  it("is not a finding at all when the Site: line carries no site", async () => {
    expect(parseProposedFindings("Finding: f\nSite:    \n")).toEqual([]);
  });
});
