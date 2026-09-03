import { describe, expect, it } from "vitest";
import { createFakeGit } from "./git.fake";
import { observation } from "./observation.fixture";
import {
  countReleasedObservations,
  DEFAULT_RATIFICATION_THRESHOLD,
  evaluateRatificationTrigger,
  isMachineryCommit,
  MACHINERY_TRAILER_LINE,
  ratificationCommitRange,
} from "./ratification-scope";

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

function logRecord(sha: string, subject: string, body: string): string {
  return ["", sha, `Bot <bot@example.com>`, subject, body].slice(1).join(FIELD_SEP) + RECORD_SEP;
}

describe("countReleasedObservations", () => {
  it("counts only what has cleared the two-site gate", () => {
    const count = countReleasedObservations([
      observation({ finding: "one site only", released: false }),
      observation({ finding: "two sites", released: true }),
      observation({ finding: "a violation", lens: "VIOLATION", released: true }),
    ]);

    expect(count).toBe(2);
  });
});

describe("evaluateRatificationTrigger — ADR-0017's two work-volume events, ORed", () => {
  it("fires on a PRD close however little has accumulated", () => {
    expect(evaluateRatificationTrigger({ releasedCount: 0, prdClosed: true })).toEqual({ shouldRatify: true });
  });

  it("fires at the threshold with no PRD close", () => {
    expect(
      evaluateRatificationTrigger({ releasedCount: DEFAULT_RATIFICATION_THRESHOLD, prdClosed: false }),
    ).toEqual({ shouldRatify: true });
  });

  it("does not fire one short of the threshold, with no clock to fire it instead", () => {
    expect(
      evaluateRatificationTrigger({ releasedCount: DEFAULT_RATIFICATION_THRESHOLD - 1, prdClosed: false }),
    ).toEqual({ shouldRatify: false });
  });
});

describe("isMachineryCommit — the trailer this lane stamps on its own commits", () => {
  it("recognises the exact line `land.ts` writes, which is what keeps a landing out of the next scope", () => {
    expect(
      isMachineryCommit({ sha: "a", author: "Bot <b@c>", subject: "Ratify: X", body: MACHINERY_TRAILER_LINE }),
    ).toBe(true);
  });

  it("leaves ordinary work alone", () => {
    expect(isMachineryCommit({ sha: "a", author: "P <p@q>", subject: "Fix a thing", body: "Part of #1" })).toBe(
      false,
    );
  });
});

describe("ratificationCommitRange", () => {
  it("excludes the machinery's own commits, so a ratifier landing never feeds the next pass", () => {
    const git = createFakeGit(() =>
      [
        logRecord("aaa", "real work", "Part of #1"),
        logRecord("bbb", "Ratify: Lane-local imports", MACHINERY_TRAILER_LINE),
        logRecord("ccc", "more real work", ""),
      ].join(""),
    );

    const range = ratificationCommitRange({ git: git.git, repoDir: "/repo", base: "base", head: "head" });

    expect(range.commits).toEqual(["aaa", "ccc"]);
    expect(range.base).toBe("base");
    expect(range.head).toBe("head");
  });

  it("reads from the repo's root when no base is given, the same convention readObservations uses", () => {
    const git = createFakeGit(() => "");

    ratificationCommitRange({ git: git.git, repoDir: "/repo", head: "head" });

    expect(git.calls[0]).toContain("head");
    expect(git.calls[0].some((arg) => arg.includes(".."))).toBe(false);
  });
});
