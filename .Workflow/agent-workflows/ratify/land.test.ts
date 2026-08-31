import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { createRecordingGh } from "../shared/gh.fake";
import type { GhExec } from "../shared/gh";
import { IMMUTABLE_SET, IMPLEMENTATION_PR_DISPATCH_ACTION } from "../shared/immutable-set";
import { observation } from "../observations/observation.fixture";
import { parseFindingMarker } from "./finding-marker";
import {
  changedFilesBetween,
  commitWorkingTree,
  LAST_RATIFIER_REF,
  LEGACY_RATIFIER_REF,
  openRatifierPr,
  RATIFIER_CRITERION,
  RATIFIER_PR_TITLE,
  readRatifierBase,
  renderRatifierBody,
  restoreWorkingTree,
  type LandedFinding,
} from "./land";

function landed(overrides: Partial<LandedFinding> = {}): LandedFinding {
  return {
    observation: observation({ finding: "duplicated validation", sites: ["a.ts:1", "b.ts:2"] }),
    landedAs: "Lane-local imports",
    reason: "two sites, one shape",
    verdict: "prose",
    ...overrides,
  };
}

describe("readRatifierBase — the bookmark, and the one it inherited from", () => {
  it("prefers this lane's own bookmark once it exists", () => {
    const git = createFakeGit((args) => (args.includes(LAST_RATIFIER_REF) ? "newbase\n" : "oldbase\n"));

    expect(readRatifierBase(git.git, "/repo")).toBe("newbase");
  });

  it("falls back to the deleted channel's bookmark, so the first run does not rescope from the root", () => {
    const git = createFakeGit((args) => {
      if (args.includes(LAST_RATIFIER_REF)) throw new Error("fatal: needed a single revision");
      if (args.includes(LEGACY_RATIFIER_REF)) return "oldbase\n";
      throw new Error(`unexpected: ${args.join(" ")}`);
    });

    expect(readRatifierBase(git.git, "/repo")).toBe("oldbase");
  });

  it("is undefined before either ref exists, which the scope read already means as `from the root`", () => {
    const git = createFakeGit(() => "");

    expect(readRatifierBase(git.git, "/repo")).toBeUndefined();
  });
});

describe("commitWorkingTree — plumbing, never a checkout", () => {
  it("stages, writes the tree and commits onto the parent, stamping the machinery trailer", () => {
    const git = createFakeGit((args) => {
      if (args.includes("write-tree")) return "newtree\n";
      if (args.includes("rev-parse")) return "oldtree\n";
      if (args.includes("commit-tree")) return "newcommit\n";
      return "";
    });

    const commit = commitWorkingTree(git.git, "/repo", "parentsha", "Ratify: X");

    expect(commit).toBe("newcommit");
    // No `checkout`, no `commit`: `HEAD` never moves out from under the trial worktree or the
    // next finding's stage.
    expect(git.calls.some((argv) => argv.includes("checkout") || argv.includes("commit"))).toBe(false);
    const commitTree = git.calls.find((argv) => argv.includes("commit-tree"))!;
    expect(commitTree).toEqual(["-C", "/repo", "commit-tree", "newtree", "-p", "parentsha", "-m", expect.any(String)]);
    expect(commitTree[7]).toContain("Ratify: X");
    expect(commitTree[7]).toContain("Machinery-Commit: true");
  });

  it("reports no commit when the stage changed nothing, rather than landing an empty one", () => {
    const git = createFakeGit((args) => (args.includes("write-tree") ? "sametree\n" : "sametree\n"));

    expect(commitWorkingTree(git.git, "/repo", "parentsha", "Ratify: X")).toBeNull();
    expect(git.calls.some((argv) => argv.includes("commit-tree"))).toBe(false);
  });
});

describe("restoreWorkingTree — the demotion's undo", () => {
  it("restores tracked files from the index and removes what the stage created, without -x", () => {
    const git = createFakeGit(() => "");

    restoreWorkingTree(git.git, "/repo");

    expect(git.calls).toEqual([
      ["-C", "/repo", "checkout-index", "-a", "-f"],
      ["-C", "/repo", "clean", "-fd"],
    ]);
  });
});

describe("changedFilesBetween", () => {
  it("drops the blank line git's own output ends with", () => {
    const git = createFakeGit(() => "a.ts\nb.ts\n");

    expect(changedFilesBetween(git.git, "/repo", "base", "head")).toEqual(["a.ts", "b.ts"]);
  });
});

describe("renderRatifierBody", () => {
  it("gives every finding a section the merge-time reader can recover it from", () => {
    const body = renderRatifierBody([landed(), landed({ landedAs: "another/rule", verdict: "mechanise" })]);

    const markers = body
      .split("\n")
      .map(parseFindingMarker)
      .filter((marker) => marker !== null);
    expect(markers.map((marker) => marker!.landedAs)).toEqual(["Lane-local imports", "another/rule"]);
  });

  it("restates the sites in prose, because the marker is invisible to the reader", () => {
    expect(renderRatifierBody([landed()])).toContain("`a.ts:1`, `b.ts:2`");
  });

  it("tells the owner the lever is a revert, since there is no checkbox anywhere", () => {
    expect(renderRatifierBody([landed()])).toMatch(/revert/i);
  });
});

describe("openRatifierPr — the refusals, all of them before any gh call", () => {
  it("refuses an empty batch", () => {
    const gh = createRecordingGh();

    expect(() =>
      openRatifierPr({ gh: gh.gh, head: "ratify/abc", base: "main", landed: [], changedFiles: ["a.ts"] }),
    ).toThrow(/empty batch/);
    expect(gh.calls).toEqual([]);
  });

  it("refuses a head that is not distinct from base", () => {
    const gh = createRecordingGh();

    expect(() =>
      openRatifierPr({ gh: gh.gh, head: "main", base: "main", landed: [landed()], changedFiles: ["a.ts"] }),
    ).toThrow(/distinct from base/);
    expect(gh.calls).toEqual([]);
  });

  it.each(IMMUTABLE_SET)("refuses a batch touching the immutable set (%s)", (entry) => {
    const gh = createRecordingGh();

    expect(() =>
      openRatifierPr({
        gh: gh.gh,
        head: "ratify/abc",
        base: "main",
        landed: [landed()],
        changedFiles: [`${entry}whatever.ts`],
      }),
    ).toThrow(/immutable set/);
    expect(gh.calls).toEqual([]);
  });
});

/**
 * A `GhExec` that answers `pr create` with a URL and records everything else. `gh.fake.ts`'s
 * `createFakeGh` models the publisher's endpoints rather than this one's, and `createRecordingGh`
 * answers nothing at all — which would leave the dispatch's own `pr` field empty and make the one
 * assertion that matters here vacuous.
 */
function fakePrGh(): { gh: GhExec; calls: string[][]; url: string } {
  const url = "https://github.com/owner/repo/pull/42";
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    return args[0] === "pr" && args[1] === "create" ? `${url}\n` : "";
  };
  return { gh, calls, url };
}

describe("openRatifierPr — the door it rings", () => {
  it("opens one PR and sends the implementation dispatch with the batch's own changed files", () => {
    const gh = fakePrGh();

    const url = openRatifierPr({
      gh: gh.gh,
      head: "ratify/abc123456789",
      base: "main",
      landed: [landed()],
      changedFiles: ["CODING_STANDARDS.md", "eslint.config.js"],
    });

    const create = gh.calls.find((argv) => argv[0] === "pr" && argv[1] === "create")!;
    expect(create).toEqual(expect.arrayContaining(["--title", RATIFIER_PR_TITLE]));
    expect(create).toEqual(expect.arrayContaining(["--head", "ratify/abc123456789"]));
    expect(create).toEqual(expect.arrayContaining(["--base", "main"]));
    // No `Closes` line anywhere: the pull request is the record, and a ticket per machine batch is
    // tracker pollution.
    expect(create[create.indexOf("--body") + 1]).not.toMatch(/\bCloses #/);
    expect(url).toBe(gh.url);

    const dispatch = gh.calls.find((argv) => argv[0] === "api")!;
    expect(dispatch).toEqual([
      "api",
      "repos/{owner}/{repo}/dispatches",
      "-f",
      `event_type=${IMPLEMENTATION_PR_DISPATCH_ACTION}`,
      "-f",
      `client_payload[pr]=${gh.url}`,
      "-f",
      "client_payload[changed_files]=CODING_STANDARDS.md,eslint.config.js",
      "-f",
      `client_payload[criteria][]=${RATIFIER_CRITERION}`,
    ]);
  });

  it("sends exactly one criterion, because a ratifier PR carries no ticket's criteria", () => {
    const gh = fakePrGh();

    openRatifierPr({
      gh: gh.gh,
      head: "ratify/abc",
      base: "main",
      landed: [landed()],
      changedFiles: ["CODING_STANDARDS.md"],
    });

    const dispatch = gh.calls.find((argv) => argv[0] === "api")!;
    const criteria = dispatch.filter((arg) => arg.startsWith("client_payload[criteria][]="));
    expect(criteria).toEqual([`client_payload[criteria][]=${RATIFIER_CRITERION}`]);
  });
});
