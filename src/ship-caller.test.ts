import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO = join(import.meta.dirname, "..");

interface Reusable {
  on: { workflow_call: { inputs: Record<string, { required: boolean }> } };
  jobs: { ship: { permissions: Record<string, string> } };
}

interface Caller {
  jobs: { ship: { uses: string; secrets: string; permissions: Record<string, string>; with: Record<string, string> } };
}

const read = <Shape>(file: string) => parse(readFileSync(join(REPO, file), "utf8")) as Shape;

describe("the ship caller file an app carries fits the reusable workflow it calls, since a drift between them fails only when the cron fires", () => {
  const reusable = read<Reusable>(".github/workflows/ship.yml");
  const call = read<Caller>(".github/ship-caller.yml").jobs.ship;
  const declared = Object.keys(reusable.on.workflow_call.inputs);
  const required = Object.entries(reusable.on.workflow_call.inputs).flatMap(([name, input]) => (input.required ? [name] : []));

  it("calls ship.yml here, handing it every required input and no input it does not declare", () => {
    expect(call.uses).toBe("collod873/claude-workflow/.github/workflows/ship.yml@main");
    expect(Object.keys(call.with)).toEqual(expect.arrayContaining(required));
    expect(Object.keys(call.with).filter((name) => !declared.includes(name))).toEqual([]);
  });

  it("grants the job every permission the reusable job asks for, since a caller can only narrow what it grants", () => {
    expect(call.permissions).toEqual(reusable.jobs.ship.permissions);
  });

  it("passes on the secrets the reusable reads to log in as the App", () => {
    expect(call.secrets).toBe("inherit");
  });
});
