import { describe, expectTypeOf, it } from "vitest";
import { stopsOf } from "./stops.ts";

describe("a stage stops only at a stop it or every stage declared", () => {
  it("takes a stop the stage declared and one every stage shares, and refuses one nobody declared", () => {
    const stoppedAt = stopsOf({ unmerged: "The closer finds its PR unmerged" });
    type Taken = Parameters<typeof stoppedAt>[0];

    expectTypeOf<"unmerged">().toExtend<Taken>();
    expectTypeOf<"modelRun">().toExtend<Taken>();
    expectTypeOf<"unlisted">().not.toExtend<Taken>();
  });
});
