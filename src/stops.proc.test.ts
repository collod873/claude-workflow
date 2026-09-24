import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { saving } from "./scenarios.ts";
import { STOPPED_AT, STOPS, STOPS_NAMED_OUTSIDE_STAGES, clearerOf } from "./stops.ts";

const REPO = resolve(import.meta.dirname, "..");
const TEST_ONLY = /\.test\.ts$|^src\/scenarios\.ts$|^src\/stops\.ts$/;

function machineText(): string {
  return spawnSync("git", ["ls-files", "src", "bin", ".github"], { cwd: REPO, encoding: "utf8" })
    .stdout.split("\n")
    .filter((file) => file !== "" && !TEST_ONLY.test(file))
    .map((file) => readFileSync(join(REPO, file), "utf8"))
    .join("\n");
}

const unnamed = (rows: string[], machine: string) => rows.filter((row) => !machine.includes(row));

describe("every red exit names a stop with a clearer (#812)", () => {
  it("gives every stage stop a clearer", () => {
    expect(Object.values(STOPS).filter((row) => clearerOf(row) === undefined)).toEqual([]);
  });

  it("finds every stop named outside the stages in a part the machine runs, so no stop promises a clearer nothing calls (#826, #827)", () => {
    expect(unnamed(Object.keys(STOPS_NAMED_OUTSIDE_STAGES), machineText())).toEqual([]);
    expect(unnamed(["The branch conflicts with main"], machineText())).toEqual(["The branch conflicts with main"]);
  });
});

describe("bin/save names only stops the fixer clears (#835)", () => {
  it("finds every stop bin/save can name cleared by the fixer", () => {
    const pushRefused = saving({ remoteRefuses: "the remote refuses every push" });
    pushRefused.run();
    const autoMergeRefused = saving({ autoMergeRefused: true });
    autoMergeRefused.run();

    const named = [pushRefused.log(), autoMergeRefused.log()].map((log) => STOPPED_AT.exec(log.split("\n")[0])?.[1] ?? "");

    expect(named.every((row) => row !== "")).toBe(true);
    expect(named.map(clearerOf)).toEqual(["the fixer", "the fixer"]);
  });
});
