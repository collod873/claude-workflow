import type { GitExec } from "./git";

/**
 * An in-memory stand-in for `GitExec`. Unlike `FakeGh` (./gh.fake.ts), which
 * models a fixed set of GitHub endpoints one publisher calls, this seam is
 * called differently by each consumer it grows to serve — a scoped range
 * diff here, git notes and a commit-log scan for release scope later — so
 * this fake does not model git plumbing itself. It records every argv
 * verbatim, in call order, and dispatches to a handler the test supplies,
 * the same shape as `createFakeStage` (./stage.fake.ts). Whatever behavior a
 * test needs from git is the test's to script, not this fake's to guess.
 *
 * A real fixture git repo, not this fake, is what proves actual diff
 * content — see observations/diff.test.ts. This fake is for callers one
 * level up, asserting argv shape (e.g. "refused before any git call") without
 * paying for a real repo.
 */
export interface FakeGit {
  git: GitExec;
  /** Every argv this fake was called with, in call order. */
  calls: string[][];
}

/**
 * Creates a `FakeGit`. `handler` computes the response for one call from its
 * argv; the default throws, so an unscripted call fails loud instead of
 * silently returning "" — which would look identical to a real command that
 * legitimately produced no output.
 */
export function createFakeGit(
  handler: (args: string[]) => string = (args) => {
    throw new Error(`fake git: unhandled argv: ${JSON.stringify(args)}`);
  },
): FakeGit {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push(args);
    return handler(args);
  };
  return { git, calls };
}
