import type { GhExec } from "../shared/gh";

/**
 * @fixture A `gh` answering issue creation from memory, reached only from the suite.
 */

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
    return "";
  };
  return { gh, calls };
}
