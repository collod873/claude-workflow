import type { GhExec } from "../../shared/gh";
import type { Sheet } from "../../shape/sheet-schema";

/**
 * The builders both collector suites need: a `Sheet` and the `gh` that serves one.
 *
 * @fixture Reached only from the suites, by design — no lane reads this. It exists because
 * `decided-context.test.ts` and `sheet.test.ts` both read a posted sheet, and each carried its own
 * copy of these two functions until adding a field to `Decision` had to be done twice and the
 * clone gate said so.
 */

/** A `Sheet` with one unmarked decision — a test overrides only the field it is about. */
export function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    restatement: "the idea as work",
    priorArt: [],
    decisions: [{ question: "q", recommendation: "r", rejected: "x", mark: "", adrTitle: "", adrReversal: "" }],
    survivors: [],
    route: "short",
    routeReason: "Short — one file.",
    newTerms: [],
    round: 0,
    ...over,
  };
}

/** A fake `gh` answering only `issue view --json body` and `issue view --json comments`. */
export function fakeSheetGh(body: string, comments: string[]): GhExec {
  return (args) => {
    const fields = args[args.indexOf("--json") + 1] ?? "";
    if (fields === "body") return JSON.stringify({ body });
    if (fields === "comments") return JSON.stringify({ comments: comments.map((b) => ({ body: b })) });
    throw new Error(`fake gh: unhandled fields: ${fields}`);
  };
}
