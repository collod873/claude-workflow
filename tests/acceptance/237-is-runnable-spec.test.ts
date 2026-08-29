import { describe, expect, it } from "vitest";
import { RUNNABLE_CRITERION, SECOND_RUNNABLE_CRITERION, specBody } from "./237-spec-pass.fixture";

/**
 * #237's first criterion: the spec-shape rule gets one implementation in the TypeScript port, so
 * lane 09's pass can ask "is this body a runnable spec" without composing the rule at its call site
 * out of `countCriteria` and `parseCheckMarker`.
 *
 * The module is loaded dynamically rather than statically imported: `shared/ticket-shape.ts` exists
 * today and `isRunnableSpec` does not, so a static named import would fail to link and take the
 * whole file down with an error about the test rather than a verdict about the ticket. Loaded this
 * way, the missing export is an assertion that does not hold yet — which is what a failing
 * acceptance test is supposed to be.
 */

type Predicate = (body: string) => unknown;

/**
 * `isRunnableSpec`'s answer read as a yes or a no.
 *
 * The name says predicate and a boolean is what this expects first; the other shapes are read only
 * so that an answer carrying the parsed command alongside its verdict is not mistaken for a
 * rejection. Every branch has to find an explicit yes — nothing here turns a refusal into an
 * acceptance, which is what would make the rejection cases below vacuous.
 */
function accepts(verdict: unknown): boolean {
  if (typeof verdict === "boolean") return verdict;
  if (typeof verdict === "string") return verdict.length > 0;
  if (verdict === null || verdict === undefined) return false;
  if (typeof verdict === "object") {
    const record = verdict as Record<string, unknown>;
    for (const key of ["runnable", "ok", "valid", "accepted"]) {
      if (typeof record[key] === "boolean") return record[key] as boolean;
    }
    if (typeof record.command === "string") return record.command.length > 0;
    if (Array.isArray(record.problems)) return record.problems.length === 0;
  }
  return false;
}

async function isRunnableSpec(body: string): Promise<boolean> {
  const shape = (await import("../../.Workflow/agent-workflows/shared/ticket-shape")) as unknown as Record<
    string,
    unknown
  >;
  const predicate = shape.isRunnableSpec;
  expect(typeof predicate, "`shared/ticket-shape.ts` must export `isRunnableSpec`").toBe("function");
  return accepts((predicate as Predicate)(body));
}

describe("#237 — isRunnableSpec mirrors bin/ticket_shape.py's spec branch", () => {
  /**
   * #237, first acceptance criterion, verbatim:
   * `isRunnableSpec` accepts exactly one well-formed check-marked criterion, rejects zero, two, or a malformed one — check: `npx vitest run .Workflow/agent-workflows/shared/ticket-shape.test.ts`
   */
  it("`isRunnableSpec` accepts exactly one well-formed check-marked criterion, rejects zero, two, or a malformed one — check: `npx vitest run .Workflow/agent-workflows/shared/ticket-shape.test.ts`", async () => {
    // Exactly one, well-formed: the owner's sentence with the shared delimiter, `check:`, and one
    // backtick-quoted command.
    expect(
      await isRunnableSpec(specBody([RUNNABLE_CRITERION])),
      "one well-formed check-marked criterion is the shape a spec must have",
    ).toBe(true);

    // Zero — the heading is there and nobody wrote a criterion under it.
    expect(
      await isRunnableSpec(specBody([])),
      "a spec with no criterion under the heading is not runnable",
    ).toBe(false);

    // Zero, the other way: no `## Acceptance criteria` heading at all.
    expect(
      await isRunnableSpec("## Problem Statement\n\nSomething is wrong and nobody said how to check it.\n"),
      "a spec body with no acceptance criteria heading is not runnable",
    ).toBe(false);

    // Two. Exactly one, not at least one: a spec with two behavioural claims is two specs, and the
    // whole value of the rule is that there is a single sentence to point at.
    expect(
      await isRunnableSpec(specBody([RUNNABLE_CRITERION, SECOND_RUNNABLE_CRITERION])),
      "two well-formed criteria are refused as firmly as none",
    ).toBe(false);

    // Malformed: one criterion, no marker at all.
    expect(
      await isRunnableSpec(specBody(["I'll know it works when I can see a verdict on a spec"])),
      "a criterion carrying no check marker is not runnable",
    ).toBe(false);

    // Malformed: the marker is attempted and the command is not backtick-quoted, so
    // `parseCheckMarker` reads it as prose.
    expect(
      await isRunnableSpec(specBody(["I'll know it works when I can see a verdict — check: gh issue list -l prd"])),
      "a check marker whose command is not backtick-quoted does not parse",
    ).toBe(false);

    // Malformed: a well-formed span followed by trailing prose, which the anchored marker pattern
    // refuses rather than silently grabbing the wrong span.
    expect(
      await isRunnableSpec(specBody(["I'll know it works when I can see a verdict — check: `true` and then some prose"])),
      "a check marker with trailing prose after the command does not parse",
    ).toBe(false);
  });
});
