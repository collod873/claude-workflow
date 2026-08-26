import type { GhExec } from "../shared/gh";

/**
 * An in-memory model of the `gh` calls lane 01 makes.
 *
 * Every call is recorded verbatim in `calls`, in order, which is what lets a
 * test assert *the shaper was never spawned* and *nothing was written* rather
 * than assume either. The fake answers the four reads this lane does —
 * `issue view --json comments`, `--json title,body`, `--json labels`, and
 * `repo view` — and records the writes without modelling their effects,
 * because no read in this lane ever depends on a write it made.
 */
export interface FakeTracker {
  gh: GhExec;
  calls: string[][];
  /** Comment bodies on each issue, oldest first — the lane's whole memory. */
  comments: Map<number, string[]>;
  /** Labels on each issue, for the accept's route override read. */
  labels: Map<number, string[]>;
  /** Issue numbers `search issues --match comments` should return. */
  searchResults: number[];
  /** Bodies `search issues --match body` should return, for the probation's re-propose check. */
  bodySearchResults: string[];
}

export interface FakeTrackerOptions {
  title?: string;
  body?: string;
  comments?: Map<number, string[]>;
  labels?: Map<number, string[]>;
  searchResults?: number[];
  bodySearchResults?: string[];
}

export function createFakeTracker(options: FakeTrackerOptions = {}): FakeTracker {
  const fake: FakeTracker = {
    gh: (args) => run(args),
    calls: [],
    comments: options.comments ?? new Map(),
    labels: options.labels ?? new Map(),
    searchResults: options.searchResults ?? [],
    bodySearchResults: options.bodySearchResults ?? [],
  };

  function run(args: string[]): string {
    fake.calls.push([...args]);

    if (args[0] === "repo" && args[1] === "view") {
      return JSON.stringify({ nameWithOwner: "collod873/claude-workflow" });
    }

    if (args[0] === "search" && args[1] === "issues") {
      return args.includes("body")
        ? JSON.stringify(fake.bodySearchResults.map((body) => ({ body })))
        : JSON.stringify(fake.searchResults.map((number) => ({ number })));
    }

    if (args[0] === "issue" && args[1] === "view") {
      const number = Number(args[2]);
      const fields = args[args.indexOf("--json") + 1] ?? "";
      if (fields.includes("comments")) {
        const bodies = fake.comments.get(number) ?? [];
        return JSON.stringify({ comments: bodies.map((body) => ({ body })) });
      }
      if (fields.includes("labels")) {
        const names = fake.labels.get(number) ?? [];
        return JSON.stringify({ labels: names.map((name) => ({ name })) });
      }
      return JSON.stringify({
        title: options.title ?? "Idea: something",
        body: options.body ?? "the owner's words",
      });
    }

    // Every write — comment, edit, close, issue create. Recorded, not modelled.
    return "";
  }

  return fake;
}

/** The bodies of every `issue comment` this fake was asked to post. */
export function postedComments(fake: FakeTracker): string[] {
  return fake.calls
    .filter((call) => call[0] === "issue" && call[1] === "comment")
    .map((call) => call[call.indexOf("--body") + 1]);
}
