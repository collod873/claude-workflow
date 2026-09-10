import { expect, test } from "vitest";
import { hookFilesTheEnrolLaneWritesIntoATarget } from "./enrol-hook-writes";

test.fails("#417.3: the enrol lane writes no hook file into a target", () => {
  expect(hookFilesTheEnrolLaneWritesIntoATarget()).toEqual([]);
});
