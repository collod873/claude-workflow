import type { GhExec } from "./gh";

/**
 * An in-memory model of the `gh` calls this pipeline makes, standing in for
 * `GhExec` in every test so no test reaches GitHub. Every call is recorded
 * verbatim in `calls`, in order — that recording is what lets a test assert
 * "refused before any write" (`calls` stays empty) rather than assume it.
 *
 * Models the three calls `publishSubIssues` makes per slice: `issue create`
 * (assigns the next issue number and its REST id), the `--jq .id` lookup on
 * that issue, and the `sub_issues` attach under the PRD. Wiring blocked-by
 * edges and reading the graph back is the next ticket's own extension of
 * this fake.
 */
export interface FakeGh {
  gh: GhExec;
  /** Every argv this fake was called with, in call order. */
  calls: string[][];
  /** Sub-issue ids attached under each PRD/parent issue number, in the
   * order they were attached. */
  subIssuesByParent: Map<number, number[]>;
}

export interface FakeGhOptions {
  /** The issue number assigned to the first `issue create` call. */
  firstIssueNumber?: number;
}

export function createFakeGh(options: FakeGhOptions = {}): FakeGh {
  const calls: string[][] = [];
  const subIssuesByParent = new Map<number, number[]>();
  const idByNumber = new Map<number, number>();
  let nextNumber = options.firstIssueNumber ?? 100;

  const gh: GhExec = (args) => {
    calls.push(args);

    if (args[0] === "issue" && args[1] === "create") {
      const number = nextNumber++;
      // A REST numeric id, deliberately distinct in shape from the issue
      // number it belongs to — the two must never be confused for one
      // another by code under test.
      const id = number * 1000 + 7;
      idByNumber.set(number, id);
      return `https://github.com/owner/repo/issues/${number}\n`;
    }

    if (args[0] === "api") {
      const path = args[1] ?? "";

      const subIssuesMatch = path.match(/^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/sub_issues$/);
      if (subIssuesMatch) {
        const parent = Number(subIssuesMatch[1]);
        const fieldFlag = args.indexOf("-f");
        const field = fieldFlag === -1 ? undefined : args[fieldFlag + 1];
        const idMatch = field?.match(/^sub_issue_id=(\d+)$/);
        if (!idMatch) {
          throw new Error(`fake gh: sub_issues call missing a well-formed -f sub_issue_id=<n>: ${JSON.stringify(args)}`);
        }
        const childId = Number(idMatch[1]);
        const list = subIssuesByParent.get(parent) ?? [];
        list.push(childId);
        subIssuesByParent.set(parent, list);
        return "";
      }

      const issueMatch = path.match(/^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/);
      const jqFlag = args.indexOf("--jq");
      if (issueMatch && jqFlag !== -1 && args[jqFlag + 1] === ".id") {
        const number = Number(issueMatch[1]);
        const id = idByNumber.get(number);
        if (id === undefined) {
          throw new Error(`fake gh: no issue #${number} was created in this fake`);
        }
        return `${id}\n`;
      }
    }

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, subIssuesByParent };
}
