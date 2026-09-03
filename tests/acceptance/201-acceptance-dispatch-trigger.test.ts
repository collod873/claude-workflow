import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { namedTypes, nestedBlock, topLevelBlock, workflowPath } from "./workflow-shape.fixture";

/**
 * #201's trigger criterion, verbatim:
 *
 * - [ ] `acceptance.yml` fires on a `repository_dispatch` type sent once per published slice,
 *   alongside its existing `issues: edited` re-fire, and names that type at `on:` (ADR-0090)
 *
 * **Lane 04 is two files now, and the criterion still holds across both.** ADR-0055 (amended by
 * ADR-0132) republished every lane as a *reusable* workflow: `acceptance.yml` declares
 * `on: workflow_call:` and nothing else, and the triggers it used to carry moved to the caller
 * stub beside it, `acceptance-caller.yml`, which is what a `uses:` job runs and what GitHub
 * attributes the run to. So "the lane fires on a `repository_dispatch` type named at `on:`" is
 * asserted where the `on:` block now lives, and the two files are tied together here by the
 * caller's own `uses:` — without that, this would be a statement about some unrelated stub.
 *
 * The half that did *not* move is reading the payload: `github.event` inside a reusable workflow is
 * the caller's event, so `acceptance.yml` is still the file that reads `client_payload`, and that
 * is still asserted against `acceptance.yml`.
 */

const acceptanceYml = workflowPath("acceptance.yml");
const callerYml = workflowPath("acceptance-caller.yml");

describe("#201 lane 04 first authoring — trigger", () => {
  // - [ ] `acceptance.yml` fires on a `repository_dispatch` type sent once per published slice, alongside its existing `issues: edited` re-fire, and names that type at `on:` (ADR-0090) — check: `grep -A3 "repository_dispatch:" .github/workflows/acceptance.yml | grep -q "types:"`
  it("`acceptance.yml` fires on a `repository_dispatch` type sent once per published slice, alongside its existing `issues: edited` re-fire, and names that type at `on:` (ADR-0090)", () => {
    expect(existsSync(acceptanceYml)).toBe(true);
    expect(existsSync(callerYml), "lane 04's caller stub is beside its reusable file").toBe(true);

    const yml = readFileSync(acceptanceYml, "utf8");
    const caller = readFileSync(callerYml, "utf8");

    // The stub really is this lane's entrance, rather than some other file that happens to carry
    // the triggers this criterion is about.
    expect(caller, "acceptance-caller.yml calls acceptance.yml").toMatch(
      /uses:\s*\S*\.github\/workflows\/acceptance\.yml@/,
    );

    const on = topLevelBlock(caller, "on");
    expect(on, "acceptance-caller.yml has an `on:` block").not.toBeNull();

    // The first-authoring trigger, with its type named at `on:` rather than matched inside a job
    // condition.
    const dispatch = nestedBlock(on as string, "repository_dispatch");
    expect(dispatch, "`on:` declares repository_dispatch").not.toBeNull();
    expect(
      namedTypes(dispatch as string).length,
      "at least one dispatch type is named at `on:`",
    ).toBeGreaterThan(0);

    // One request per published slice: repository_dispatch carries the slice in client_payload, and
    // the reusable file — which sees the caller's own event — is what reads it.
    expect(yml).toMatch(/client_payload/);

    // The existing issues: edited re-fire survives alongside it.
    const issues = nestedBlock(on as string, "issues");
    expect(issues, "`on:` still declares issues").not.toBeNull();
    expect(issues as string).toMatch(/edited/);

    // And the reusable half is reached only through that stub: a second `on:` trigger on
    // `acceptance.yml` would be a run nothing attributes to it (ADR-0055, amended by ADR-0132).
    const reusableOn = topLevelBlock(yml, "on");
    expect(reusableOn, "acceptance.yml has an `on:` block").not.toBeNull();
    expect(reusableOn as string).toMatch(/workflow_call\s*:/);
  });
});
