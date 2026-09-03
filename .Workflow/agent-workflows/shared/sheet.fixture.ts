import type { Sheet } from "./sheet-schema";

/**
 * @fixture Reached only from test suites, by design — no lane builds a sheet from nothing. It
 * exists because `spec/collectors/decided-context.test.ts` and `spec/collectors/sheet.test.ts`
 * both read a posted sheet, and each carried its own copy until adding a field to `Decision` had
 * to be done twice and the clone gate said so.
 */
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
