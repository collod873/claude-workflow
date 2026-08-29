import type { GhExec } from "../shared/gh";

/**
 * The `gh` stand-in lane 02's own tests share.
 *
 * `shared/gh.fake.ts` models the sub-issue and dependency APIs lane 03 writes and answers nothing
 * else; every door in this lane instead *reads an issue* — `gh issue view … --json <fields>` — and
 * writes comments, labels and dispatches it only ever asserts on afterwards. The same hand-rolled
 * recorder for that had been written once per door, differing only in which field set it answered,
 * and the clone gate carried the pair as standing debt. A fake defined twice drifts, and a gate
 * assertion is only worth what the calls it was handed are.
 */

/** What a `gh issue create` answers here — every test that publishes lands on #903. */
export const FAKE_CREATED_ISSUE_URL = "https://github.com/owner/repo/issues/903\n";

export interface FakeIssueGh {
  gh: GhExec;
  /** Every argv this fake was called with, in call order — writes included. */
  calls: string[][];
}

/**
 * Records every call and answers each `issue view … --json <fields>` through `read`, which returns
 * `undefined` for a field set the caller's door never asks for — a throw rather than an empty
 * answer, because a collector fed `""` fails somewhere far from the read that was wrong.
 *
 * Every other call answers empty, which is what `gh` itself prints for the comment, label and
 * dispatch writes this lane makes; a test asserts on `calls`, never on their return.
 */
export function createIssueGh(read: (fields: string) => string | undefined): FakeIssueGh {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    if (args[0] === "issue" && args[1] === "view") {
      const fields = args[args.indexOf("--json") + 1] ?? "";
      const answer = read(fields);
      if (answer === undefined) throw new Error(`fake gh: unhandled fields: ${fields}`);
      return answer;
    }
    if (args[0] === "issue" && args[1] === "create") return FAKE_CREATED_ISSUE_URL;
    return "";
  };
  return { gh, calls };
}
