import type { GhExec } from "../shared/gh";

/**
 * @fixture A tracker answering from memory, for the suite alone: a lane reaching it is a lane that
 * never talked to GitHub.
 */

export interface FakeTracker {
  gh: GhExec;
  calls: string[][];
  comments: Map<number, string[]>;
  labels: Map<number, string[]>;
  searchResults: number[];
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

    return "";
  }

  return fake;
}

export function postedComments(fake: FakeTracker): string[] {
  return fake.calls
    .filter((call) => call[0] === "issue" && call[1] === "comment")
    .map((call) => call[call.indexOf("--body") + 1]);
}
