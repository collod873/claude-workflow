import type { Sheet } from "./sheet-schema";

/**
 * The one builder for a `Sheet` fixture — a sheet with a single unmarked decision, so a test
 * names only the field it is actually about. See CODING_STANDARDS.md, "Fixtures through one
 * builder": the builder lives beside the zod schema it constructs, which is why it sits here
 * rather than in the collector suites that read a posted sheet.
 *
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
