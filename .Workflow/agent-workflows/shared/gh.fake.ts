import type { GhExec } from "./gh";

/**
 * An in-memory model of the `gh` calls this pipeline makes, standing in for
 * `GhExec` in every test so no test reaches GitHub. Every call is recorded
 * verbatim in `calls`, in order — that recording is what lets a test assert
 * "refused before any write" (`calls` stays empty) rather than assume it.
 *
 * Models the calls `publishSubIssues` makes per slice — `issue create`
 * (assigns the next issue number and its REST id), the `--jq .id` lookup on
 * that issue, and the `sub_issues` attach under the PRD — plus the
 * dependencies API a slice's `dependsOn` wires and reads back: `POST
 * .../dependencies/blocked_by` (field `issue_id`) to add an edge, and `GET
 * .../dependencies/blocked_by` to read the graph GitHub actually recorded.
 * `dropEdges` lets a test tell the fake to accept a wiring write (it is
 * still recorded in `calls`) but silently omit it from what the read-back
 * GET returns — modelling a write that reports success but never actually
 * lands, which is the only way a read-back-verification test has anything
 * to catch.
 */
export interface FakeGh {
  gh: GhExec;
  /** Every argv this fake was called with, in call order. */
  calls: string[][];
  /** Sub-issue ids attached under each PRD/parent issue number, in the
   * order they were attached. */
  subIssuesByParent: Map<number, number[]>;
  /** Blocker issue ids recorded as blocking each issue number, in the order
   * they were wired — what the fake's read-back GET returns, except for any
   * edge named in `dropEdges`. */
  blockedByByNumber: Map<number, number[]>;
}

export interface FakeGhOptions {
  /** The issue number assigned to the first `issue create` call. */
  firstIssueNumber?: number;
  /** Blocked-by edges to accept in the wiring write (recorded in `calls`
   * like any other call) but never store, so the read-back GET omits them —
   * simulates a write GitHub accepted but never actually landed. */
  dropEdges?: Array<{ blockedNumber: number; blockerNumber: number }>;
}

export function createFakeGh(options: FakeGhOptions = {}): FakeGh {
  const calls: string[][] = [];
  const subIssuesByParent = new Map<number, number[]>();
  const blockedByByNumber = new Map<number, number[]>();
  const idByNumber = new Map<number, number>();
  const numberById = new Map<number, number>();
  const dropEdges = options.dropEdges ?? [];
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
      numberById.set(id, number);
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

      const blockedByMatch = path.match(
        /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/dependencies\/blocked_by$/,
      );
      if (blockedByMatch) {
        const blockedNumber = Number(blockedByMatch[1]);
        const fieldFlag = args.indexOf("-f");

        if (fieldFlag !== -1) {
          // Write: wiring one blocked-by edge.
          const field = args[fieldFlag + 1];
          const idMatch = field?.match(/^issue_id=(\d+)$/);
          if (!idMatch) {
            throw new Error(`fake gh: blocked_by wiring call missing a well-formed -f issue_id=<n>: ${JSON.stringify(args)}`);
          }
          const blockerId = Number(idMatch[1]);
          const blockerNumber = numberById.get(blockerId);
          const dropped = dropEdges.some(
            (edge) => edge.blockedNumber === blockedNumber && edge.blockerNumber === blockerNumber,
          );
          if (!dropped) {
            const list = blockedByByNumber.get(blockedNumber) ?? [];
            list.push(blockerId);
            blockedByByNumber.set(blockedNumber, list);
          }
          return "";
        }

        // Read: the read-back GET for this issue's blocked-by graph.
        const ids = blockedByByNumber.get(blockedNumber) ?? [];
        return `${JSON.stringify(ids)}\n`;
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

  return { gh, calls, subIssuesByParent, blockedByByNumber };
}
