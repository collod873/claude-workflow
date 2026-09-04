import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { laneIds, readWorkflow, workflowNames } from "./read-workflow";
import { REPO_ROOT } from "./repo-sources";

const outDir = mkdtempSync(join(tmpdir(), "canary-graph-gen-"));
execFileSync("node", [join(REPO_ROOT, "bin/canary-graph-gen.mjs"), outDir], { stdio: "ignore" });

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const stubs = readdirSync(join(outDir, ".github/workflows")).map((file) => ({ id: file.replace(/\.yml$/, ""), file }));

function sourceOf(id: string): string {
  const caller = `${id}-caller.yml`;
  return workflowNames().includes(caller) ? caller : `${id}.yml`;
}

function doorsOf(on: Record<string, unknown> | undefined, where: string): Record<string, unknown> {
  if (on === undefined) throw new Error(`${where} declares no on: block`);
  return Object.fromEntries(Object.entries(on).map(([event, condition]) => [event, event === "workflow_dispatch" ? null : condition]));
}

function stubDoors(file: string): Record<string, unknown> {
  const path = join(outDir, ".github/workflows", file);
  return doorsOf((parse(readFileSync(path, "utf8")) as { on?: Record<string, unknown> }).on, path);
}

describe("every canary-graph stub's on: block agrees with the lane workflow it is a copy of", () => {
  it("generates a stub at all, the copies the assertions below are about", () => {
    expect(stubs).not.toEqual([]);
  });

  it.each(stubs)("$file fires on exactly the doors its lane ships", ({ id, file }) => {
    const source = sourceOf(id);

    expect(workflowNames().includes(source), `${file} stubs a lane with no ${source} in this repo`).toBe(true);
    const real = readWorkflow<{ on?: Record<string, unknown> }>(source).workflow.on;
    expect(stubDoors(file)).toEqual(doorsOf(real, source));
  });

  it("stubs every lane that has a caller, so a lane added to the graph is not silently untested", () => {
    const stubbed = new Set(stubs.map((stub) => stub.id));

    expect(laneIds().filter((id) => !stubbed.has(id))).toEqual([]);
  });
});
