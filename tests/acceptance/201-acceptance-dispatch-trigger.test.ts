import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { namedTypes, nestedBlock, topLevelBlock, workflowPath } from "./workflow-shape.fixture";

const acceptanceYml = workflowPath("acceptance.yml");

describe("#201 lane 04 first authoring — trigger", () => {
  // - [ ] `acceptance.yml` fires on a `repository_dispatch` type sent once per published slice, alongside its existing `issues: edited` re-fire, and names that type at `on:` (ADR-0090) — check: `grep -A3 "repository_dispatch:" .github/workflows/acceptance.yml | grep -q "types:"`
  it("`acceptance.yml` fires on a `repository_dispatch` type sent once per published slice, alongside its existing `issues: edited` re-fire, and names that type at `on:` (ADR-0090)", () => {
    expect(existsSync(acceptanceYml)).toBe(true);
    const yml = readFileSync(acceptanceYml, "utf8");

    const on = topLevelBlock(yml, "on");
    expect(on, "acceptance.yml has an `on:` block").not.toBeNull();

    // The new first-authoring trigger, with its type named at `on:` rather than
    // matched inside a job condition.
    const dispatch = nestedBlock(on as string, "repository_dispatch");
    expect(dispatch, "`on:` declares repository_dispatch").not.toBeNull();
    expect(
      namedTypes(dispatch as string).length,
      "at least one dispatch type is named at `on:`",
    ).toBeGreaterThan(0);

    // One request per published slice: repository_dispatch carries the slice in
    // client_payload, so the workflow has to read it.
    expect(yml).toMatch(/client_payload/);

    // The existing issues: edited re-fire survives alongside it.
    const issues = nestedBlock(on as string, "issues");
    expect(issues, "`on:` still declares issues").not.toBeNull();
    expect(issues as string).toMatch(/edited/);
  });
});
