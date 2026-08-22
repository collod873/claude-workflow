import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractOutput } from "./output-block";

const schema = z.object({ greeting: z.string() });

describe("extractOutput", () => {
  it("returns the parsed, validated object for a response ending in a single <output> block", () => {
    const raw = `Some reasoning prose.\n\nHere is the plan.\n<output>${JSON.stringify({ greeting: "hi" })}</output>`;

    expect(extractOutput(raw, schema)).toEqual({ greeting: "hi" });
  });

  it("throws naming the reason when the block is missing entirely", () => {
    const raw = "Just prose, no output block at all.";

    expect(() => extractOutput(raw, schema)).toThrow(/no <output> block/);
  });

  it("throws naming the reason when there is more than one <output> block", () => {
    const raw = `<output>${JSON.stringify({ greeting: "one" })}</output>\nmore text\n<output>${JSON.stringify({ greeting: "two" })}</output>`;

    expect(() => extractOutput(raw, schema)).toThrow(/expected exactly one/);
  });

  it("throws naming the reason when content follows the </output> tag", () => {
    const raw = `<output>${JSON.stringify({ greeting: "hi" })}</output>\ntrailing prose the model kept writing`;

    expect(() => extractOutput(raw, schema)).toThrow(/does not end in its <output> block/);
  });

  it("throws naming the reason when the block is not valid JSON", () => {
    const raw = "<output>{not json</output>";

    expect(() => extractOutput(raw, schema)).toThrow(/not valid JSON/);
  });

  it("throws naming the reason when the parsed JSON fails the supplied schema", () => {
    const raw = `<output>${JSON.stringify({ greeting: 42 })}</output>`;

    expect(() => extractOutput(raw, schema)).toThrow(/failed schema validation/);
  });
});
