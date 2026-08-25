import type { GhExec } from "../shared/gh";

/**
 * An in-memory model of the tracker calls the close gate makes, standing in
 * for `GhExec` in every test so no test reaches GitHub.
 *
 * A second fake rather than an extension of `shared/gh.fake.ts` because the
 * two model disjoint halves of the API — that one answers the publisher's
 * sub-issue and dependency writes, this one answers a reader's `issue view`
 * and a gate's `reopen`/`edit`/`comment`. Merging them would give each
 * test's fake a large surface of calls its subject can never make, and the
 * thing both fakes exist for is the assertion that a refusal wrote *only*
 * what it should have.
 *
 * Every call is recorded verbatim in `calls`, in order. That recording is
 * what lets a test assert "passed without touching the issue" (`calls`
 * holds the read and nothing else) rather than assume it.
 */
export interface FakeTracker {
  gh: GhExec;
  /** Every argv this fake was called with, in call order. */
  calls: string[][];
  /** Whether `issue reopen` was called, and with what comment. */
  reopenedWith: string | null;
  /** Labels added via `issue edit --add-label`, in order. */
  labelsAdded: string[];
  /** Bodies posted via `issue comment`, in order. */
  commentsPosted: string[];
}

export interface FakeTrackerOptions {
  /** The issue body `issue view` reports. */
  body?: string;
  /** The issue's comments, oldest-first, as the tracker returns them. */
  comments?: string[];
  /** Make `issue view` fail, modelling a tracker that will not answer. */
  viewFails?: boolean;
  /** Make `issue view` return something that is not a well-formed answer. */
  viewReturns?: string;
  /** Make `issue edit --add-label` fail, modelling a missing label. */
  labelFails?: boolean;
}

export function createFakeTracker(options: FakeTrackerOptions = {}): FakeTracker {
  const calls: string[][] = [];
  const labelsAdded: string[] = [];
  const commentsPosted: string[] = [];
  const tracker: FakeTracker = {
    gh: () => "",
    calls,
    reopenedWith: null,
    labelsAdded,
    commentsPosted,
  };

  tracker.gh = (args) => {
    calls.push(args);

    if (args[0] === "issue" && args[1] === "view") {
      if (options.viewFails) {
        throw new Error("fake tracker: gh issue view refused");
      }
      if (options.viewReturns !== undefined) {
        return options.viewReturns;
      }
      return JSON.stringify({
        body: options.body ?? "",
        comments: (options.comments ?? []).map((body) => ({ body })),
      });
    }

    if (args[0] === "issue" && args[1] === "reopen") {
      const commentFlag = args.indexOf("--comment");
      tracker.reopenedWith = commentFlag === -1 ? "" : args[commentFlag + 1];
      return "";
    }

    if (args[0] === "issue" && args[1] === "edit") {
      if (options.labelFails) {
        throw new Error("fake tracker: no such label");
      }
      const labelFlag = args.indexOf("--add-label");
      if (labelFlag !== -1) {
        labelsAdded.push(args[labelFlag + 1]);
      }
      return "";
    }

    if (args[0] === "issue" && args[1] === "comment") {
      const bodyFlag = args.indexOf("--body");
      commentsPosted.push(bodyFlag === -1 ? "" : args[bodyFlag + 1]);
      return "";
    }

    throw new Error(`fake tracker: unhandled argv: ${JSON.stringify(args)}`);
  };

  return tracker;
}
