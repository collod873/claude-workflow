import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { WORKFLOWS_DIR } from "./read-workflow";

/**
 * CODING_STANDARDS.md, "Pin a mandated copy to its source". `bin/canary-graph-gen.mjs` writes one
 * stub workflow per lane carrying that lane's real `on:` block, because the whole point of the
 * graph-noop run is to fire the doors production ships rather than doors someone typed. The stubs
 * are pushed to a throwaway repository, so nothing in this tree compiles them against the lanes
 * they mirror and the generator's own header says what a drifted copy is worth: nothing. This test
 * is what reads both texts — it runs the generator and holds each stub's doors equal to the real
 * lane's.
 *
 * One normalisation, applied to every lane alike: a `workflow_dispatch` door is compared on
 * presence only. Its `inputs:` are a form a person fills in, not a condition on whether the door
 * fires, and the canary never hand-runs a lane.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const outDir = mkdtempSync(join(tmpdir(), "canary-graph-gen-"));
execFileSync("node", [join(REPO_ROOT, "bin/canary-graph-gen.mjs"), outDir], { stdio: "ignore" });

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

/** The lane ids the generator wrote a stub for, read off what it actually produced. */
const stubs = readdirSync(join(outDir, ".github/workflows")).map((file) => ({ id: file.replace(/\.yml$/, ""), file }));

/**
 * The real workflow a stub mirrors, derived the way the lane set itself is: a lane's caller stub,
 * or the lane's own file when it has no caller (`enrol.yml`, `walk-home.yml`, which say at their
 * own tops why they have none).
 */
function sourceOf(id: string): string {
  const caller = `${id}-caller.yml`;
  return existsSync(join(WORKFLOWS_DIR, caller)) ? caller : `${id}.yml`;
}

/** Every door a workflow's `on:` block opens, keyed by event, with a hand-run door's form dropped. */
function doorsIn(path: string): Record<string, unknown> {
  const on = (parse(readFileSync(path, "utf8")) as { on?: Record<string, unknown> }).on;
  if (on === undefined) throw new Error(`${path} declares no on: block`);
  return Object.fromEntries(Object.entries(on).map(([event, condition]) => [event, event === "workflow_dispatch" ? null : condition]));
}

describe("every canary-graph stub's on: block agrees with the lane workflow it is a copy of", () => {
  it("generates a stub at all — the copies the assertions below are about", () => {
    expect(stubs).not.toEqual([]);
  });

  it.each(stubs)("$file fires on exactly the doors its lane ships", ({ id, file }) => {
    const source = sourceOf(id);

    expect(existsSync(join(WORKFLOWS_DIR, source)), `${file} stubs a lane with no ${source} in this repo`).toBe(true);
    expect(doorsIn(join(outDir, ".github/workflows", file))).toEqual(doorsIn(join(WORKFLOWS_DIR, source)));
  });

  it("stubs every lane that has a caller, so a lane added to the graph is not silently untested", () => {
    const called = readdirSync(WORKFLOWS_DIR)
      .filter((file) => file.endsWith("-caller.yml"))
      .map((file) => file.replace(/-caller\.yml$/, ""));
    const stubbed = new Set(stubs.map((stub) => stub.id));

    expect(called.filter((id) => !stubbed.has(id))).toEqual([]);
  });
});
