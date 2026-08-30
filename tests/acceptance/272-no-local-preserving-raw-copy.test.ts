import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  TO_TICKETS_SOURCE,
  cleanUp,
  filesUnder,
  makeTmp,
  readIfPresent,
  runLaneProbe,
} from "./272-checkpoint.fixture";

/**
 * #272's sixth criterion, quoted verbatim in the test name below.
 *
 * The first half reads the lane's own source for a declaration of either name - a copy is a
 * declaration, and "function preservingRaw" also catches the `export async function` and
 * `export function` spellings.
 *
 * The second half is what keeps the first from being satisfied by deleting the behaviour along with
 * the copy: a refused response must still be kept where the next reader can find it, and the
 * failure must still name where that is. It asserts nothing about which directory under the handoff
 * venue that file lands in, because the relocation is free to move it and the criterion is not
 * about the address.
 */

const REFUSED = JSON.stringify({ entries: ["one line\ntwo lines"] });

const tmps: string[] = [];
afterAll(() => cleanUp(tmps));

describe("the raw-response machinery lives in one place", () => {
  it("to-tickets.ts keeps no local preservingRaw or rawResponsePath copy — check: `npx vitest run .Workflow/agent-workflows/to-tickets/to-tickets.test.ts`", () => {
    const source = readFileSync(TO_TICKETS_SOURCE, "utf8");
    for (const name of ["preservingRaw", "rawResponsePath"]) {
      expect(source, "to-tickets.ts still declares its own " + name).not.toContain(
        "function " + name,
      );
      expect(source, "to-tickets.ts still declares its own " + name).not.toContain("const " + name);
    }

    const tmp = makeTmp();
    tmps.push(tmp);
    const run = runLaneProbe(tmp, [{ stage: "seam-sweep", response: REFUSED }]);
    expect(run.error, "the run could not be driven at all").toBeNull();

    const failure = run.steps[0].error ?? "";
    expect(failure, "the refused response was accepted rather than refused").toMatch(
      /failed schema validation/,
    );

    const kept = filesUnder(tmp).filter((file) =>
      (readIfPresent(file) ?? "").includes("two lines"),
    );
    expect(
      kept.length,
      "no file under " + tmp + " kept the refused response, so the relocation dropped it",
    ).toBeGreaterThan(0);
    expect(
      kept.some((file) => failure.includes(file)),
      "the failure does not name where the refused response was saved: " + failure,
    ).toBe(true);
  }, 900_000);
});
