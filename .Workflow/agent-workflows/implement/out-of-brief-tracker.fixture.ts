import { githubHoldingClaims, type ClaimHost } from "../shared/claim-host.fixture";

/**
 * @fixture Reached only from the suite, by design.
 */
export interface TrackedIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  comments: string[];
}

export function trackerWith(ticket?: { title: string; body: string }): ClaimHost & { issues: TrackedIssue[] } {
  const issues: TrackedIssue[] = [];
  let nextNumber = 1;

  const host = githubHoldingClaims({
    ticket,
    answer: (args) => {
      if (args[0] !== "issue") return undefined;
      if (args[1] === "view" && args[args.indexOf("--json") + 1] === "comments") {
        const number = Number(args[2]);
        const issue = issues.find((each) => each.number === number);
        if (!issue) throw new Error(`tracker: issue view on unknown #${number}`);
        return JSON.stringify({ comments: issue.comments.map((body) => ({ body })) });
      }
      if (args[1] === "list") {
        return JSON.stringify(issues.map(({ number, body, state }) => ({ number, body, state })));
      }
      if (args[1] === "create") {
        const number = nextNumber++;
        issues.push({ number, title: args[args.indexOf("--title") + 1], body: args[args.indexOf("--body") + 1], state: "OPEN", comments: [] });
        return `https://github.com/owner/repo/issues/${number}\n`;
      }
      if (args[1] === "comment") {
        const number = Number(args[2]);
        const issue = issues.find((each) => each.number === number);
        if (!issue) throw new Error(`tracker: issue comment on unknown #${number}`);
        issue.comments.push(args[args.indexOf("--body") + 1]);
        return "";
      }
      return undefined;
    },
  });

  return { ...host, issues };
}
