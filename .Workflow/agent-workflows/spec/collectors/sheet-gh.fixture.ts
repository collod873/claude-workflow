import type { GhExec } from "../../shared/gh";

/**
 * @fixture Reached only from the suites, by design: no lane reads a posted sheet back.
 */

export function fakeSheetGh(body: string, comments: string[]): GhExec {
  return (args) => {
    const fields = args[args.indexOf("--json") + 1] ?? "";
    if (fields === "body") return JSON.stringify({ body });
    if (fields === "comments") return JSON.stringify({ comments: comments.map((b) => ({ body: b })) });
    throw new Error(`fake gh: unhandled fields: ${fields}`);
  };
}
