import type { GhExec } from "../../shared/gh";

/**
 * The `gh` both collector suites need: one that serves a posted sheet.
 *
 * @fixture Reached only from the suites, by design — no lane reads this. It exists because
 * `decided-context.test.ts` and `sheet.test.ts` both read a posted sheet, and each carried its
 * own copy of this function until the clone gate said so. The `Sheet` those suites feed it is
 * built by `shape/sheet.fixture.ts`, beside the schema.
 */

export function fakeSheetGh(body: string, comments: string[]): GhExec {
  return (args) => {
    const fields = args[args.indexOf("--json") + 1] ?? "";
    if (fields === "body") return JSON.stringify({ body });
    if (fields === "comments") return JSON.stringify({ comments: comments.map((b) => ({ body: b })) });
    throw new Error(`fake gh: unhandled fields: ${fields}`);
  };
}
