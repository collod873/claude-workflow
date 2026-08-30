import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `bin/close-ticket`'s `undelivered` — the precondition `--spec` refuses on — driven in the real
 * interpreter against the real function. `undelivered`'s own docstring in `bin/close-ticket` is the
 * home for why the question is asked from the pull request's side (#195, #233, #253).
 *
 * The cases below are the payload shapes `closedByPullRequestsReferences` returns, not a second
 * copy of the parsing. Driven through Python rather than restated in TypeScript for
 * `render-body.test.ts`'s reason: a TypeScript belief about what the Python decides is the thing
 * that was wrong.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CLOSE_TICKET = join(REPO_ROOT, "bin/close-ticket");

/** A `subIssues` node as the GraphQL query returns it. */
function child(
  number: number,
  overrides: {
    state?: string;
    stateReason?: string | null;
    prs?: { number: number; merged: boolean }[];
  } = {},
): unknown {
  return {
    number,
    state: overrides.state ?? "CLOSED",
    stateReason: overrides.stateReason ?? "COMPLETED",
    closedByPullRequestsReferences: { nodes: overrides.prs ?? [] },
  };
}

/** `undelivered(children)`, run by the real `bin/close-ticket` loaded as a module. */
function undelivered(children: unknown[]): string[] {
  const reader = `
import importlib.util, json, sys
from importlib.machinery import SourceFileLoader
# Named through an explicit loader: the script has no \`.py\` suffix, and
# \`spec_from_file_location\` alone declines to guess a loader for that.
loader = SourceFileLoader("close_ticket", ${JSON.stringify(CLOSE_TICKET)})
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)
print(json.dumps(module.undelivered(json.load(sys.stdin))))
`;
  const run = spawnSync("python3", ["-c", reader], {
    input: JSON.stringify(children),
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as string[];
}

describe("undelivered", () => {
  it("delivers a child the Actions bot closed whose number a merged PR body closes", () => {
    // #237 exactly: closed by lane 08 itself, so no `closer` on the close event, and PR #244's
    // body ends `Closes #237`.
    expect(undelivered([child(237, { prs: [{ number: 244, merged: true }] })])).toEqual([]);
  });

  it("delivers every slice of a spec the chain built end to end", () => {
    const children = [
      child(237, { prs: [{ number: 244, merged: true }] }),
      child(238, { prs: [{ number: 246, merged: true }] }),
      child(239, { prs: [{ number: 247, merged: true }] }),
      child(240, { prs: [{ number: 248, merged: true }] }),
      child(241, { prs: [{ number: 250, merged: true }] }),
      child(242, { prs: [{ number: 249, merged: true }] }),
    ];

    expect(undelivered(children)).toEqual([]);
  });

  it("refuses a child closed with no pull request naming it — closed by hand", () => {
    expect(undelivered([child(9, { prs: [] })])).toEqual([
      "#9: closed by hand, not by a merged PR",
    ]);
  });

  it("refuses a child named only by a pull request that never merged", () => {
    expect(undelivered([child(9, { prs: [{ number: 12, merged: false }] })])).toEqual([
      "#9: closed by PR #12, which is not merged",
    ]);
  });

  it("delivers a child one of whose naming pull requests merged", () => {
    const prs = [
      { number: 11, merged: false },
      { number: 12, merged: true },
    ];

    expect(undelivered([child(9, { prs })])).toEqual([]);
  });

  it("refuses a child that is still open even when a merged PR names it", () => {
    const open = child(9, { state: "OPEN", stateReason: null, prs: [{ number: 12, merged: true }] });

    expect(undelivered([open])).toEqual(["#9: still open"]);
  });

  it("refuses a child closed as not planned, merged PR or not", () => {
    const notPlanned = child(9, {
      stateReason: "NOT_PLANNED",
      prs: [{ number: 12, merged: true }],
    });

    expect(undelivered([notPlanned])).toEqual([
      "#9: closed as not planned — not delivered",
    ]);
  });

  it("passes a spec that was never sliced — nothing is undelivered", () => {
    expect(undelivered([])).toEqual([]);
  });

  it("names every undelivered child, not just the first", () => {
    const children = [
      child(1, { prs: [{ number: 44, merged: true }] }),
      child(2, { prs: [] }),
      child(3, { state: "OPEN", stateReason: null }),
    ];

    expect(undelivered(children)).toEqual([
      "#2: closed by hand, not by a merged PR",
      "#3: still open",
    ]);
  });
});
