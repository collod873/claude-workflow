import type { Observation } from "./observation-schema";
import type { MechanisedFinding, ProseFinding, ReleaseBatch } from "./release-batch-schema";

/**
 * The one builder for a `MechanisedFinding` fixture. Everything but
 * `observation` is derived from it, so a test names only the field it is
 * actually about — see CODING_STANDARDS.md, "A test builds a schema-typed
 * fixture through one exported builder".
 */
export function mechanisedFinding(
  overrides: Partial<MechanisedFinding> & { observation: Observation },
): MechanisedFinding {
  return {
    diff: `--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-// ${overrides.observation.finding}\n+// fixed\n`,
    ...overrides,
  };
}

/**
 * The one builder for a `ProseFinding` fixture. Everything but
 * `observation` is derived from it — same rationale as `mechanisedFinding`
 * above.
 */
export function proseFinding(overrides: Partial<ProseFinding> & { observation: Observation }): ProseFinding {
  return {
    checklistItem: `Add a CODING_STANDARDS.md entry for "${overrides.observation.finding}".`,
    ...overrides,
  };
}

/**
 * The one builder for a `ReleaseBatch` fixture. Defaults to a batch with
 * nothing release-eligible in either half — the shape `composeRelease`
 * treats as "no `gh` call at all" — so a test opts into whichever half it
 * is actually exercising.
 */
export function releaseBatch(overrides: Partial<ReleaseBatch> = {}): ReleaseBatch {
  return {
    mechanised: [],
    prose: [],
    ...overrides,
  };
}
