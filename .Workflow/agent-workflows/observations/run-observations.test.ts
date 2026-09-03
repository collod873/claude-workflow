import { describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { createFakeStage } from "../shared/stage.fake";
import { readObservations } from "../shared/notes";
import { makeTempRepo } from "../shared/temp-repo.fixture";
import { runObservations } from "./run-observations";

describe("runObservations", () => {
  it("runs both lenses and writes one note on head merging a PROPOSED and a VIOLATION entry", async () => {
    const repo = makeTempRepo("run-observations");
    repo.write("a.ts", "export const a = 1;\n");
    const base = repo.commit("seed");
    repo.write("a.ts", "export const a = 2;\n");
    const head = repo.commit("the session's own commit");
    // The same fake stage backs both lenses' sandboxed calls, so this one
    // response is parsed by both PROPOSED's and VIOLATION's parsers.
    const fakeStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:1\n");

    const result = await runObservations({
      git: execGit,
      exec: fakeStage.exec,
      repoDir: repo.dir,
      base,
      head,
      touchedPaths: ["a.ts"],
      spine: "the session's own spine",
      standards: "entry: never duplicate validation logic",
    });

    expect(result).toEqual([
      { finding: "duplicated validation logic", lens: "PROPOSED", sites: ["a.ts:1"], released: false },
      { finding: "duplicated validation logic", lens: "VIOLATION", sites: ["a.ts:1"], released: true },
    ]);

    const stored = readObservations({ git: execGit, repoDir: repo.dir, base, head });
    expect(stored).toEqual([{ commit: head, observations: result }]);
  });

  it("folds the prior note's findings in, releasing a finding once a second run names a second site", async () => {
    const repo = makeTempRepo("run-observations");
    repo.write("a.ts", "export const a = 1;\n");
    const base = repo.commit("seed");
    repo.write("a.ts", "export const a = 2;\n");
    const firstHead = repo.commit("first session");
    const firstStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:1\n");
    const firstRun = await runObservations({
      git: execGit,
      exec: firstStage.exec,
      repoDir: repo.dir,
      base,
      head: firstHead,
      spine: "first session's spine",
      standards: "entry: never duplicate validation logic",
    });
    // firstRun[0] is the PROPOSED entry — VIOLATION's is always released,
    // so it's PROPOSED's gate this assertion is pinning.
    expect(firstRun[0].released).toBe(false);

    repo.write("b.ts", "export const b = 1;\n");
    const secondHead = repo.commit("second session");
    const secondStage = createFakeStage("Finding: duplicated validation logic\nSite: b.ts:1\n");

    const secondRun = await runObservations({
      git: execGit,
      exec: secondStage.exec,
      repoDir: repo.dir,
      base: firstHead,
      head: secondHead,
      spine: "second session's spine",
      standards: "entry: never duplicate validation logic",
    });

    expect(secondRun).toEqual([
      {
        finding: "duplicated validation logic",
        lens: "PROPOSED",
        sites: ["a.ts:1", "b.ts:1"],
        released: true,
      },
      {
        finding: "duplicated validation logic",
        lens: "VIOLATION",
        sites: ["b.ts:1"],
        released: true,
      },
    ]);
  });
});
