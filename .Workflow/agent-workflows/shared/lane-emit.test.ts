import { describe, expect, it } from "vitest";
import { emitEstate } from "./lane-wiring";
import { readWorkflow, workflowNames } from "./read-workflow";

const emitted = emitEstate();

describe("the committed estate is exactly what the registry emits", () => {
  it("emits one file for every file under .github/workflows, and no file it does not", () => {
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.map((file) => file.name).sort()).toEqual(workflowNames().sort());
  });

  it.each(emitted.map((file) => file.name))("%s is byte-identical to what the registry emits", (name) => {
    const file = emitted.find((each) => each.name === name);
    expect(
      readWorkflow(name).source,
      `${name} disagrees with shared/lane-wiring.ts; edit the registry and run \`npm run lane-wiring\`, never the YAML`,
    ).toBe(file?.content);
  });
});
