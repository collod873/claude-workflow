import { describe, expect, it } from "vitest";
import { execGit } from "./git";
import { createFakeGit } from "./git.fake";
import { observation } from "./observation.fixture";
import { ratificationRecord } from "./ratification.fixture";
import {
  filterByRatificationMemory,
  readRatificationRecords,
  writeRatificationNote,
} from "./ratification";
import { makeTempRepo } from "./temp-repo.fixture";

describe("filterByRatificationMemory", () => {
  it("drops a declined finding from the release-eligible set when this run's sites haven't grown", () => {
    const declined = ratificationRecord({ finding: "duplicated validation logic", sites: ["a.ts:1", "b.ts:2"] });
    const thisRun = observation({ finding: "duplicated validation logic", sites: ["a.ts:1", "b.ts:2"] });

    const result = filterByRatificationMemory({ observations: [thisRun], priorRatifications: [declined] });

    expect(result).toEqual([]);
  });

  it("carries a declined finding forward as release-eligible once a run shows a site the decision didn't name", () => {
    const declined = ratificationRecord({ finding: "duplicated validation logic", sites: ["a.ts:1", "b.ts:2"] });
    const thisRun = observation({
      finding: "duplicated validation logic",
      sites: ["a.ts:1", "b.ts:2", "c.ts:3"],
    });

    const result = filterByRatificationMemory({ observations: [thisRun], priorRatifications: [declined] });

    expect(result).toEqual([thisRun]);
  });

  it("passes a finding through untouched when it has no ratification record at all", () => {
    const thisRun = observation({ finding: "never ratified" });

    const result = filterByRatificationMemory({ observations: [thisRun], priorRatifications: [] });

    expect(result).toEqual([thisRun]);
  });

  it("passes a finding through untouched when its recorded decision was ratified, not declined", () => {
    const ratified = ratificationRecord({
      finding: "duplicated validation logic",
      decision: "ratified",
      sites: ["a.ts:1"],
      reason: "landed as a lint rule",
    });
    const thisRun = observation({ finding: "duplicated validation logic", sites: ["a.ts:1"] });

    const result = filterByRatificationMemory({ observations: [thisRun], priorRatifications: [ratified] });

    expect(result).toEqual([thisRun]);
  });

  it("only reconsiders the declined finding, leaving an unrelated finding in the run alone", () => {
    const declined = ratificationRecord({ finding: "declined one", sites: ["a.ts:1"] });
    const stillDeclined = observation({ finding: "declined one", sites: ["a.ts:1"] });
    const unrelated = observation({ finding: "unrelated finding", sites: ["z.ts:9"] });

    const result = filterByRatificationMemory({
      observations: [stillDeclined, unrelated],
      priorRatifications: [declined],
    });

    expect(result).toEqual([unrelated]);
  });
});

describe("writeRatificationNote / readRatificationRecords argv shape", () => {
  it("writes via `notes --ref=ratifications add -f`, keyed to the given commit", () => {
    const fake = createFakeGit(() => "");
    const record = ratificationRecord({ finding: "f" });

    writeRatificationNote({ git: fake.git, repoDir: "/some/repo", commit: "abc123", records: [record] });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv.slice(0, 7)).toEqual(["-C", "/some/repo", "notes", "--ref=ratifications", "add", "-f", "-m"]);
    expect(JSON.parse(argv[7])).toEqual([record]);
    expect(argv[8]).toBe("abc123");
  });

  it("reads via `log <range> --notes=ratifications`, threading repoDir as -C", () => {
    const fake = createFakeGit(() => "");

    readRatificationRecords({ git: fake.git, repoDir: "/some/repo", base: "abc", head: "def" });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].slice(0, 5)).toEqual(["-C", "/some/repo", "log", "abc..def", "--notes=ratifications"]);
  });

  it("reads the unbounded ref alone, not a range, when base is omitted", () => {
    const fake = createFakeGit(() => "");

    readRatificationRecords({ git: fake.git, repoDir: "/some/repo", head: "def" });

    const [argv] = fake.calls;
    expect(argv[3]).toBe("def");
  });
});

describe("writeRatificationNote / readRatificationRecords against a real repo", () => {
  it("reads a written note back as a flat list, and overwrites rather than appends on a second write", () => {
    const repo = makeTempRepo("ratification-notes");
    repo.write("a.ts", "export const a = 1;\n");
    const base = repo.commit("seed");
    repo.write("a.ts", "export const a = 2;\n");
    const head = repo.commit("the release commit");

    writeRatificationNote({
      git: execGit,
      repoDir: repo.dir,
      commit: head,
      records: [ratificationRecord({ finding: "first pass" })],
    });
    writeRatificationNote({
      git: execGit,
      repoDir: repo.dir,
      commit: head,
      records: [ratificationRecord({ finding: "merged, second pass" })],
    });

    const result = readRatificationRecords({ git: execGit, repoDir: repo.dir, base, head });

    expect(result).toEqual([ratificationRecord({ finding: "merged, second pass" })]);
  });
});
