import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { repoRoot } from "./workflow-shape.fixture";

/**
 * #239 — `bin/ticket_shape.py`'s `spec` branch, re-vendored from `collod873/agent-skills`, stops
 * returning an empty warning list unconditionally and refuses a body that is not exactly one
 * well-formed check-marked criterion.
 *
 * Run through the real interpreter the way the criterion's own check does — `PYTHONPATH=bin`, a
 * `python3 -c` that imports the module and calls `validate` — because the exit status is the thing
 * being asserted. The body travels in an environment variable so no quoting sits between the test
 * and the shape under test.
 *
 * **The tree `validate` is given is an empty scratch directory, not this checkout.** ADR-0130 added
 * one thing to the `spec` branch that no other branch has: it *runs* the criterion's check command,
 * in `repo_root`, and refuses a body whose criterion is already true before any work exists. The
 * accepted body below names a tracker read (`gh issue list …`) on purpose — that is the asymmetry
 * this criterion is about, since the same command is refused outright for a `ticket` — and against
 * this repository that command exits 0, so the shape test was reporting on the state of the live
 * tracker rather than on the shape of the body. `validate` takes `repo_root` precisely so a caller
 * can pin the tree; pinned at a directory with no git remote, `gh` is red for every run on every
 * machine, which is what makes this an assertion about `ticket_shape.py` again. Nothing else in
 * this file reaches the green check at all — every other body is refused on its shape first.
 */

const BIN = path.join(repoRoot, "bin");
const PROGRAM =
  "import os, pathlib, ticket_shape; " +
  "ticket_shape.validate('spec', os.environ['BODY'], pathlib.Path(os.environ['TREE']))";

/** A tree with no git remote, so a criterion's tracker read is red here whatever the tracker says. */
const TREE = mkdtempSync(path.join(tmpdir(), "acceptance-239-"));

afterAll(() => {
  rmSync(TREE, { recursive: true, force: true });
});

function validateSpec(body: string): SpawnSyncReturns<string> {
  const result = spawnSync("python3", ["-c", PROGRAM], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: BIN, BODY: body, TREE },
  });
  expect(result.error, `python3 did not run: ${result.error?.message ?? ""}`).toBeUndefined();
  expect(
    typeof result.status,
    `python3 did not exit normally (signal ${String(result.signal)})`,
  ).toBe("number");
  return result;
}

const ONE_CHECKED_CRITERION = [
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when I can see a verdict comment on the spec — check: `gh issue list -l prd -s all -L 100 --json comments`",
  "",
].join("\n");

const TWO_CHECKED_CRITERIA = [
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when I can see a verdict comment on the spec — check: `gh issue list -l prd -s all -L 100 --json comments`",
  "- [ ] I'll know it works when I can see the spec close itself — check: `gh issue view 226 --json state`",
  "",
].join("\n");

const NO_MARKER = [
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when I can see a verdict comment on the spec",
  "",
].join("\n");

const ESCAPE_MARKER = [
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when the pipeline feels right — check: none, because it is a matter of taste",
  "",
].join("\n");

describe("#239 ticket_shape.py spec branch", () => {
  // Acceptance criterion, verbatim:
  // ticket_shape.py's `spec` branch is no longer an unconditional no-op — check: `PYTHONPATH=bin python3 -c "import ticket_shape as t; t.validate('spec', 'x')"; test $? -ne 0`
  it("refuses a spec body that is not exactly one well-formed check-marked criterion, and accepts one that is", () => {
    const bare = validateSpec("x");
    expect(
      bare.status,
      "validate('spec', 'x') exited 0 — the spec branch is still the unconditional no-op",
    ).not.toBe(0);
    expect(
      bare.stderr,
      `a spec body carrying no '## Acceptance criteria' heading has to raise ValidationError; got: ${bare.stderr}`,
    ).toContain("ValidationError");

    // Not an unconditional refusal either: exactly one criterion carrying a well-formed marker is
    // the shape a spec is required to have, and a command that reads the tracker is accepted for a
    // spec where it is refused for a ticket.
    const good = validateSpec(ONE_CHECKED_CRITERION);
    expect(
      good.status,
      `a spec body with exactly one check-marked criterion has to validate; stderr: ${good.stderr}`,
    ).toBe(0);

    expect(
      validateSpec(TWO_CHECKED_CRITERIA).status,
      "a spec body with two criteria has to be refused — exactly one, not at least one",
    ).not.toBe(0);
    expect(
      validateSpec(NO_MARKER).status,
      "a spec body whose one criterion carries no check marker has to be refused",
    ).not.toBe(0);
    expect(
      validateSpec(ESCAPE_MARKER).status,
      "`check: none, because …` is not an escape marker — a marker that does not parse is a refusal",
    ).not.toBe(0);
  });
});
