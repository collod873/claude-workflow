import type { GhExec } from "../../shared/gh";

export function mapTrackerGh(mapNumber: number, body: string, ticketComments: Record<number, string[]> = {}): GhExec {
  return (args) => {
    const issueNumber = Number(args[2]);
    const fields = args[args.indexOf("--json") + 1] ?? "";
    if (fields === "body") {
      if (issueNumber !== mapNumber) throw new Error(`fake gh: unexpected body fetch for #${issueNumber}`);
      return JSON.stringify({ body });
    }
    if (fields === "comments") {
      const comments = ticketComments[issueNumber];
      if (comments === undefined) throw new Error(`fake gh: unexpected comments fetch for #${issueNumber}`);
      return JSON.stringify({ comments: comments.map((b) => ({ body: b })) });
    }
    throw new Error(`fake gh: unhandled fields: ${fields}`);
  };
}
