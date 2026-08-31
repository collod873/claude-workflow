import type { GhExec } from "./gh";
import { blockedByPathMatcher, GIT_REFS_PATH, issuePathMatcher, subIssuesPathMatcher } from "./gh-paths";

/**
 * The extra sentence a field-shape rejection carries when the call used
 * `gh api -f`. Both id-taking endpoints this fake models want a JSON
 * integer, and `-f` is `gh`'s *always-a-string* flag — the typed one is
 * `-F`. This fake accepted `-f` until to-tickets run 32679981039 sent it to
 * the real API and got `Invalid property /sub_issue_id: "5230263052" is not
 * of type integer (HTTP 422)`, which is a distinction only the wire could
 * make and this stand-in was erasing.
 */
function untypedFieldHint(args: string[]): string {
  if (!args.includes("-f")) {
    return "";
  }
  return " — this call used -f, which sends a string; these endpoints take a JSON integer, so it must be -F";
}

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
  /** Every `POST /repos/{owner}/{repo}/dispatches` this fake received, in
   * call order, with its `event_type` and `client_payload[…]` fields already
   * split out — so a test asserts on what was dispatched rather than
   * re-parsing argv. */
  dispatches: FakeDispatch[];
}

/** One `repository_dispatch` send, as `createFakeGh` records it. */
export interface FakeDispatch {
  eventType: string;
  /** `client_payload[k]=v` pairs. A repeated `client_payload[k][]=v` array
   * field keeps only its last value here; assert those against `calls`. */
  payload: Record<string, string>;
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
  const dispatches: FakeDispatch[] = [];
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

      const subIssuesMatch = path.match(subIssuesPathMatcher);
      if (subIssuesMatch) {
        const parent = Number(subIssuesMatch[1]);
        const fieldFlag = args.indexOf("-F");
        const field = fieldFlag === -1 ? undefined : args[fieldFlag + 1];
        const idMatch = field?.match(/^sub_issue_id=(\d+)$/);
        if (!idMatch) {
          throw new Error(
            `fake gh: sub_issues call missing a well-formed -F sub_issue_id=<n>: ${JSON.stringify(args)}${untypedFieldHint(args)}`,
          );
        }
        const childId = Number(idMatch[1]);
        const list = subIssuesByParent.get(parent) ?? [];
        list.push(childId);
        subIssuesByParent.set(parent, list);
        return "";
      }

      const blockedByMatch = path.match(blockedByPathMatcher);
      if (blockedByMatch) {
        const blockedNumber = Number(blockedByMatch[1]);
        const fieldFlag = args.indexOf("-F");

        if (fieldFlag !== -1 || args.includes("-f")) {
          // Write: wiring one blocked-by edge.
          const field = args[fieldFlag + 1];
          const idMatch = field?.match(/^issue_id=(\d+)$/);
          if (!idMatch) {
            throw new Error(
              `fake gh: blocked_by wiring call missing a well-formed -F issue_id=<n>: ${JSON.stringify(args)}${untypedFieldHint(args)}`,
            );
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

      // `POST /repos/{owner}/{repo}/dispatches` — what a lane sends to start the next one
      // (`applyGate`, `dispatchReadySlices`, `openPrAndDispatch`). Recorded rather than answered:
      // GitHub returns 204 with no body, and so does this.
      if (path === "repos/{owner}/{repo}/dispatches") {
        const payload: Record<string, string> = {};
        let eventType = "";
        for (let i = 0; i < args.length; i++) {
          if (args[i] !== "-f") continue;
          const [key, ...rest] = (args[i + 1] ?? "").split("=");
          const value = rest.join("=");
          if (key === "event_type") {
            eventType = value;
            continue;
          }
          const fieldMatch = key?.match(/^client_payload\[(.+?)\](\[\])?$/);
          if (fieldMatch) {
            payload[fieldMatch[1]] = value;
          }
        }
        dispatches.push({ eventType, payload });
        return "";
      }

      const issueMatch = path.match(issuePathMatcher);
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

  return { gh, calls, subIssuesByParent, blockedByByNumber, dispatches };
}

/**
 * Simulates `POST`/`DELETE .../git/refs` — the atomic claim primitive `claimImplementationBranch`
 * uses (#179) — honestly enough for a takeover test to be about anything (#196): `POST` 422s when
 * `refs` already holds the ref, exactly like the real endpoint, and `DELETE` releases it.
 *
 * A standalone function rather than another `FakeGh` branch: `implement/implement.test.ts` and
 * `recover/recover.test.ts` each model a *different* rest of `gh` around the same claim mechanic,
 * so what they share is this one primitive, called from inside each file's own `GhExec` before it
 * falls through to whatever else it answers. Returns `undefined` for any call that isn't one of
 * these two, which is what lets a caller compose it in with a plain `if`.
 */
export function simulateClaimRef(args: string[], refs: Set<string>): string | undefined {
  if (args[0] === "api" && args[1] === GIT_REFS_PATH) {
    const ref = (args.find((arg) => arg.startsWith("ref=refs/heads/")) ?? "").slice("ref=refs/heads/".length);
    if (refs.has(ref)) throw new Error("HTTP 422: Reference already exists");
    refs.add(ref);
    return "";
  }
  if (args[0] === "api" && args[1] === "--method" && args[2] === "DELETE") {
    refs.delete(args[3].slice(`${GIT_REFS_PATH}/heads/`.length));
    return "";
  }
  return undefined;
}

/**
 * A fake `GhExec` that records every call verbatim, in order, and answers
 * nothing — for tests that assert only on what was sent. `createFakeGh`
 * above simulates GitHub's answers; this one deliberately does not, so a
 * lane under test cannot come to depend on a response its test never wrote.
 */
export function createRecordingGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    return "";
  };
  return { gh, calls };
}
