import type { GitExec } from "./git";

/**
 * @fixture A `git` that records argv instead of running it, reached only from the suite.
 */

export interface FakeGit {
  git: GitExec;
  calls: string[][];
}

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
