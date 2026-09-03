import type { GhExec } from "./gh";
import { blockedByPathMatcher, GIT_REFS_PATH, issuePathMatcher, subIssuesPathMatcher } from "./gh-paths";

function untypedFieldHint(args: string[]): string {
  if (!args.includes("-f")) {
    return "";
  }
  return " — this call used -f, which sends a string; these endpoints take a JSON integer, so it must be -F";
}

export interface FakeGh {
  gh: GhExec;
  calls: string[][];
  subIssuesByParent: Map<number, number[]>;
  blockedByByNumber: Map<number, number[]>;
  dispatches: FakeDispatch[];
}

export interface FakeDispatch {
  eventType: string;
  payload: Record<string, string>;
}

export interface FakeGhOptions {
  firstIssueNumber?: number;
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

        const ids = blockedByByNumber.get(blockedNumber) ?? [];
        return `${JSON.stringify(ids)}\n`;
      }

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

export function createRecordingGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    return "";
  };
  return { gh, calls };
}
