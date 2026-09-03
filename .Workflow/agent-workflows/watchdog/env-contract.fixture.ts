import { readFileSync } from "node:fs";
import { expect } from "vitest";

/**
 * Asserts that `workflow` (a workflow file's text) sets every `process.env.NAME` that the
 * entrypoint at `entrypoint` reads — except the `ambient` ones every runner already carries, which
 * a workflow is not expected to restate.
 *
 * Every watchdog lane has this contract, and every watchdog suite had its own copy of the loop
 * that checks it. One copy, so the next lane's suite asserts the contract rather than retyping
 * it, and so a workflow that stops setting a variable is caught by the same words wherever it is.
 *
 * @fixture Reached only from the suites, by design.
 */
export function expectWorkflowSetsEveryVariableRead(options: {
  workflow: string;
  workflowFile: string;
  entrypoint: string;
  ambient?: string[];
}): void {
  const source = readFileSync(options.entrypoint, "utf8");
  const read = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((match) => match[1]);
  const ambient = new Set(options.ambient ?? []);

  expect(read.length).toBeGreaterThan(0);
  for (const name of new Set(read)) {
    if (ambient.has(name)) continue;
    expect(options.workflow, `${options.workflowFile} never sets ${name}`).toMatch(new RegExp(`^ +${name}:`, "m"));
  }
}
