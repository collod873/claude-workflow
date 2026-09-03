import type { GhExec } from "../../shared/gh";

/**
 * The `gh` the map collector reads: `issue view <map> --json body` for the Wayfinder Map itself,
 * and `--json comments` for each ticket its `## Decisions so far` links to.
 *
 * Strict on purpose — a body fetch for any issue but the map, or a comments fetch for a ticket the
 * test never modelled, throws rather than answering empty, because a collector fed `""` fails
 * somewhere far from the read that was wrong.
 *
 * Reached only from the suites, by design. `map.test.ts` and `decided-context.test.ts` each
 * carried a copy until the clone gate lost its baseline (#360).
 */
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
