import type { GhExec } from "./gh";
import { trackerMemory } from "./tracker-memory";

/**
 * @fixture A `gh` answering from memory, for the suite alone: a lane reaching it is a lane that
 * never talked to the tracker.
 */

const DISPATCHES_PATH = "repos/{owner}/{repo}/dispatches";

export interface FakeGh {
  gh: GhExec;
  calls: string[][];
  dispatches: FakeDispatch[];
}

export interface FakeDispatch {
  eventType: string;
  payload: Record<string, string>;
}

export interface FakeGhOptions {
  firstIssueNumber?: number;
}

export function createFakeGh(options: FakeGhOptions = {}): FakeGh {
  const calls: string[][] = [];
  const dispatches: FakeDispatch[] = [];
  const tracker = trackerMemory({ firstIssueNumber: (options.firstIssueNumber ?? 100) - 1 });

  const gh: GhExec = (args) => {
    calls.push(args);

    if (args[0] === "issue" && args[1] === "create") {
      const titleFlag = args.indexOf("--title");
      const bodyFlag = args.indexOf("--body");
      const number = tracker.createIssue({
        title: titleFlag === -1 ? "" : args[titleFlag + 1],
        body: bodyFlag === -1 ? "" : args[bodyFlag + 1],
        assignee: "",
      });
      return `https://github.com/owner/repo/issues/${number}\n`;
    }

    if (args[1] === DISPATCHES_PATH) {
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

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, dispatches };
}

export function createRecordingGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    return "";
  };
  return { gh, calls };
}

export function answerIssueQueue(args: string[], issues: readonly object[]): string | undefined {
  if (args[0] === "issue" && args[1] === "list") return JSON.stringify(issues);
  if (args[0] === "issue" && args[1] === "create") return "https://github.com/owner/repo/issues/42\n";
  return undefined;
}

export function answerIssueQueueOrThrow(args: string[], issues: readonly object[]): string {
  const answered = answerIssueQueue(args, issues);
  if (answered !== undefined) return answered;
  throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
}

export const FAKE_CREATED_ISSUE_URL = "https://github.com/owner/repo/issues/903\n";

export interface FakeIssueGh {
  gh: GhExec;
  calls: string[][];
}

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
    if (args[0] === "issue" && args[1] === "list") return "[]";
    return "";
  };
  return { gh, calls };
}
