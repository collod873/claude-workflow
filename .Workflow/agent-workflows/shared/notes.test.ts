import { describe, expect, it } from "vitest";
import { execGit } from "./git";
import { createFakeGit } from "./git.fake";
import { observation } from "./observation.fixture";
import { readObservations, writeObservationNote } from "./notes";
import { makeTempRepo, type TempRepo } from "./temp-repo.fixture";

function commitFile(repo: TempRepo, path: string, contents: string, message: string): string {
  repo.write(path, contents);
  return repo.commit(message);
}

function seededRepo({ withB = false } = {}): { repo: TempRepo; base: string; head: string } {
  const repo = makeTempRepo("observation-notes");
  const base = commitFile(repo, "a.ts", "export const a = 1;\n", "seed a");
  if (withB) commitFile(repo, "b.ts", "export const b = 1;\n", "seed b");
  const head = commitFile(repo, "a.ts", "export const a = 2;\n", "the session's own commit");
  return { repo, base, head };
}

function readAfterDeleting(repo: TempRepo, base: string, path: string): ReturnType<typeof readObservations> {
  repo.remove(path);
  const afterDeletion = repo.commit(`deletes ${path}`);
  return readObservations({ git: execGit, repoDir: repo.dir, base, head: afterDeletion });
}

function writeNote(repo: TempRepo, commit: string, ...observations: ReturnType<typeof observation>[]): void {
  writeObservationNote({ git: execGit, repoDir: repo.dir, commit, observations });
}

describe("writeObservationNote / readObservations", () => {
  it("reads a written note back keyed to the exact commit the finding is about", () => {
    const { repo, base, head } = seededRepo();

    const finding = observation({ finding: "duplicated validation logic", sites: ["a.ts:1"] });
    writeNote(repo, head, finding);

    const result = readObservations({ git: execGit, repoDir: repo.dir, base, head });

    expect(result).toEqual([{ commit: head, observations: [finding] }]);
  });

  it("drops a finding about a file the repo later deletes from a read scoped after the deletion", () => {
    const { repo, base, head: withFinding } = seededRepo();
    writeNote(repo, withFinding, observation({ finding: "duplicated validation logic", sites: ["a.ts:1"] }));

    const result = readAfterDeleting(repo, base, "a.ts");

    expect(result).toEqual([]);
  });

  it("keeps a finding whose file survives, dropping only the one whose file is gone, on the same commit", () => {
    const { repo, base, head: withFindings } = seededRepo({ withB: true });
    const surviving = observation({ finding: "still here", sites: ["a.ts:1"] });
    const stale = observation({ finding: "about to go stale", sites: ["b.ts:1"] });
    writeNote(repo, withFindings, surviving, stale);

    const result = readAfterDeleting(repo, base, "b.ts");

    expect(result).toEqual([{ commit: withFindings, observations: [surviving] }]);
  });

  it("keeps a finding alive when at least one of its several sites still exists", () => {
    const { repo, base, head } = seededRepo({ withB: true });
    const finding = observation({ finding: "seen twice", sites: ["a.ts:1", "b.ts:1"], released: true });
    writeNote(repo, head, finding);

    const result = readAfterDeleting(repo, base, "b.ts");

    expect(result).toEqual([{ commit: head, observations: [finding] }]);
  });

  it("keeps a finding whose site names a real file behind prose, as the first real audit's four do", () => {
    const { repo, base, head } = seededRepo();

    const finding = observation({
      finding: "scratch-project detection duplicated",
      sites: ["a.ts:212 (isScratchProject)", "a.ts (main(), summary console.log)"],
      released: true,
    });
    writeNote(repo, head, finding);

    const result = readObservations({ git: execGit, repoDir: repo.dir, base, head, log: () => {} });

    expect(result).toEqual([{ commit: head, observations: [finding] }]);
  });

  it("names the finding and the file when it drops one whose file is gone", () => {
    const { repo, base, head: withFinding } = seededRepo({ withB: true });
    writeNote(repo, withFinding, observation({ finding: "about to go stale", sites: ["b.ts:1"] }));
    repo.remove("b.ts");
    const afterDeletion = repo.commit("deletes b.ts");

    const lines: string[] = [];
    readObservations({ git: execGit, repoDir: repo.dir, base, head: afterDeletion, log: (line) => lines.push(line) });

    const dropped = lines.filter((line) => line.startsWith("dropped "));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain("about to go stale");
    expect(dropped[0]).toContain(`b.ts does not exist at ${afterDeletion}`);
    expect(dropped[0]).not.toContain("is not a path");
  });

  it("distinguishes a site that was never a path from one whose file is gone", () => {
    const { repo, base, head } = seededRepo();
    writeNote(repo, head, observation({ finding: "site is prose", sites: ["gone.ts (some function)"] }));

    const lines: string[] = [];
    readObservations({ git: execGit, repoDir: repo.dir, base, head, log: (line) => lines.push(line) });

    expect(lines.some((line) => line.startsWith("note:") && line.includes("is not a path"))).toBe(true);
    const dropped = lines.find((line) => line.startsWith("dropped "));
    expect(dropped).toContain("is not a path");
    expect(dropped).toContain("gone.ts does not exist");
  });

  it("says a surviving finding's site is not a path, since nothing else would ever report it", () => {
    const { repo, base, head } = seededRepo();
    writeNote(repo, head, observation({ finding: "survives anyway", sites: ["a.ts:1 (theFunction)"] }));

    const lines: string[] = [];
    const result = readObservations({ git: execGit, repoDir: repo.dir, base, head, log: (line) => lines.push(line) });

    expect(result).toHaveLength(1);
    expect(lines.some((line) => line.startsWith("note:") && line.includes("survives anyway"))).toBe(true);
    expect(lines.some((line) => line.startsWith("dropped "))).toBe(false);
  });

  it("excludes commits outside the range, same as sessionRangeDiff's own bound", () => {
    const repo = makeTempRepo("observation-notes");
    const base = commitFile(repo, "a.ts", "export const a = 1;\n", "seed");
    writeNote(repo, base, observation({ finding: "outside the range" })); 
    const head = commitFile(repo, "a.ts", "export const a = 2;\n", "inside the range");
    writeNote(repo, head, observation({ finding: "inside the range" }));

    const result = readObservations({ git: execGit, repoDir: repo.dir, base, head });

    expect(result).toEqual([{ commit: head, observations: [observation({ finding: "inside the range" })] }]);
  });

  it("reads from the repo's root when base is omitted", () => {
    const repo = makeTempRepo("observation-notes");
    const root = commitFile(repo, "a.ts", "export const a = 1;\n", "seed");
    writeNote(repo, root, observation({ finding: "from the root" }));

    const result = readObservations({ git: execGit, repoDir: repo.dir, head: root });

    expect(result).toEqual([{ commit: root, observations: [observation({ finding: "from the root" })] }]);
  });

  it("overwrites, rather than appends to, a note already on that commit", () => {
    const { repo, base, head } = seededRepo();

    writeNote(repo, head, observation({ finding: "first pass" }));
    writeNote(repo, head, observation({ finding: "merged, second pass" }));

    const result = readObservations({ git: execGit, repoDir: repo.dir, base, head });

    expect(result).toEqual([{ commit: head, observations: [observation({ finding: "merged, second pass" })] }]);
  });
});

describe("writeObservationNote argv shape", () => {
  it("writes via `notes --ref=observations add -f`, keyed to the given commit", () => {
    const fake = createFakeGit(() => "");

    writeObservationNote({
      git: fake.git,
      repoDir: "/some/repo",
      commit: "abc123",
      observations: [observation({ finding: "f" })],
    });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv.slice(0, 7)).toEqual(["-C", "/some/repo", "notes", "--ref=observations", "add", "-f", "-m"]);
    expect(JSON.parse(argv[7])).toEqual([observation({ finding: "f" })]);
    expect(argv[8]).toBe("abc123");
  });
});

describe("readObservations argv shape", () => {
  it("reads via `log <range> --notes=observations`, threading repoDir as -C", () => {
    const fake = createFakeGit(() => "");

    readObservations({ git: fake.git, repoDir: "/some/repo", base: "abc", head: "def" });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].slice(0, 5)).toEqual(["-C", "/some/repo", "log", "abc..def", "--notes=observations"]);
  });

  it("reads the unbounded ref alone, not a range, when base is omitted", () => {
    const fake = createFakeGit(() => "");

    readObservations({ git: fake.git, repoDir: "/some/repo", head: "def" });

    const [argv] = fake.calls;
    expect(argv[3]).toBe("def");
  });
});
