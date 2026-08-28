import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REFUTER_OUTPUT, SHAPER_OUTPUT } from "../shape/sheet-schema";
import { SWEEP_OUTPUT, Sweep } from "../shape/sweep-schema";
import { SEAM_SWEEP_OUTPUT, SeamManifest } from "../to-tickets/seam-sweep/schema";
import { AUDIT_OUTPUT, AuditOutput, Plan, SLICE_OUTPUT } from "./plan-schema";
import { rejectedResponse, structuredOutput, type StructuredOutput } from "./structured-output";

const Greeting = z.object({ greeting: z.string().min(1) });

describe("the JSON Schema handed to the CLI", () => {
  it("is object-rooted, which is the only root the API's tool-input validation takes", () => {
    const schema = JSON.parse(structuredOutput(Greeting).jsonSchema) as Record<string, unknown>;

    expect(schema.type).toBe("object");
  });

  /**
   * `Plan` and `SeamManifest` are bare arrays, and an array root is refused
   * with `tools.N.custom.input_schema.type: Input should be 'object'` — a 400
   * that arrives only once the stage has already spawned. `wrapIn` is how a
   * stage gets past it, and this is the check that the wrapper is real rather
   * than described.
   */
  it("wraps a root that is not an object, under the field the stage named", () => {
    const schema = JSON.parse(structuredOutput(z.array(z.string()), "entries").jsonSchema) as {
      type: string;
      properties: Record<string, { type: string }>;
    };

    expect(schema.type).toBe("object");
    expect(schema.properties.entries.type).toBe("array");
  });

  it("refuses a non-object root at construction, rather than letting the API refuse it mid-run", () => {
    expect(() => structuredOutput(z.array(z.string()))).toThrow(/object-rooted/);
  });

  it("carries no `$schema` or `$ref`, which are document conventions rather than shape", () => {
    const text = structuredOutput(AuditOutput).jsonSchema;

    expect(text).not.toContain("$schema");
    expect(text).not.toContain("$ref");
  });
});

/**
 * The property #147 is really about: the schema each stage sends is
 * **derived** from that stage's zod schema, not a second copy kept beside it.
 *
 * A hand-written schema is not wrong on the day it is written — it is wrong
 * on the day the zod schema gains a field and nobody remembers the other
 * copy. So the assertion is not "this schema looks right", which a stale copy
 * also passes; it is "this schema's fields are exactly the zod schema's
 * fields", which a stale copy cannot be.
 */
describe("each stage's schema tracks its zod schema rather than a copy of it", () => {
  /** The `properties` keys and `required` list of one derived schema. */
  function jsonFields(output: StructuredOutput<unknown>): {
    properties: string[];
    required: string[];
  } {
    const schema = JSON.parse(output.jsonSchema) as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    return {
      properties: Object.keys(schema.properties).sort(),
      required: [...(schema.required ?? [])].sort(),
    };
  }

  it("derives the slice stage's schema from Plan in plan-schema.ts", () => {
    const slices = (
      JSON.parse(SLICE_OUTPUT.jsonSchema) as {
        properties: { slices: { items: { properties: Record<string, unknown>; required: string[] } } };
      }
    ).properties.slices.items;

    // Every field of `Slice`, and no other — so a field added to the zod
    // schema and forgotten here fails, which is the whole point.
    expect(Object.keys(slices.properties).sort()).toEqual(Object.keys(Plan.element.shape).sort());
    // `dependsOn` is `.default([])`, so it is the one field the model may omit.
    expect(slices.required.sort()).toEqual(
      Object.keys(Plan.element.shape)
        .filter((key) => key !== "dependsOn")
        .sort(),
    );
  });

  it("derives the seam-sweep stage's schema from SeamManifest in seam-sweep/schema.ts", () => {
    const schema = JSON.parse(SEAM_SWEEP_OUTPUT.jsonSchema) as {
      properties: { entries: { type: string; items: { type: string } } };
      required: string[];
    };

    expect(schema.properties.entries.type).toBe("array");
    expect(schema.properties.entries.items.type).toBe("string");
    expect(schema.required).toEqual(["entries"]);
  });

  it("derives the audit stage's schema from AuditOutput in plan-schema.ts", () => {
    expect(jsonFields(AUDIT_OUTPUT)).toEqual({
      properties: Object.keys(AuditOutput.shape).sort(),
      // `notes` is `.default("")`; a silent grading is a legal answer.
      required: ["slices"],
    });
  });

  it("derives the sweep and refuter stages' schemas from theirs", () => {
    expect(jsonFields(SWEEP_OUTPUT).properties).toEqual(Object.keys(Sweep.shape).sort());
    expect(jsonFields(REFUTER_OUTPUT).properties).toEqual(["survivors"]);
  });

  it("derives the shaper stage's schema from its union, both branches kept", () => {
    const answer = (
      JSON.parse(SHAPER_OUTPUT.jsonSchema) as {
        properties: { answer: { anyOf: Array<{ properties: { kind: { const?: string } } }> } };
      }
    ).properties.answer;

    expect(answer.anyOf).toHaveLength(2);
    expect(answer.anyOf.map((branch) => branch.properties.kind.const)).toEqual([
      "sheet",
      "re-sweep",
    ]);
  });
});

describe("parsing a response", () => {
  it("returns the value, unwrapped, for a schema that was wrapped on the wire", () => {
    expect(SEAM_SWEEP_OUTPUT.parse(JSON.stringify({ entries: ["a seam"] }))).toEqual(["a seam"]);
  });

  it("returns the value as-is for a schema that needed no wrapper", () => {
    expect(structuredOutput(Greeting).parse(JSON.stringify({ greeting: "hello" }))).toEqual({
      greeting: "hello",
    });
  });

  it("names a response that is not JSON at all — the shape of a run that never called the tool", () => {
    expect(() => SEAM_SWEEP_OUTPUT.parse("the model just talked")).toThrow(/not valid JSON/);
  });

  it("names a response the schema refuses", () => {
    expect(() => SEAM_SWEEP_OUTPUT.parse(JSON.stringify({ wrong: [] }))).toThrow(
      /failed schema validation/,
    );
  });

  /**
   * A zod `.refine()` has no JSON Schema keyword behind it, so
   * `SeamManifestEntry`'s no-newline rule is dropped by the derivation and the
   * API accepts a manifest entry with a newline in it. zod is what refuses it
   * on the way back — which is the reason `parse` re-validates at all rather
   * than trusting the API's check to have been the whole one.
   */
  it("still enforces the rules JSON Schema cannot carry", () => {
    expect(SEAM_SWEEP_OUTPUT.jsonSchema).not.toContain("newline");
    expect(() =>
      SEAM_SWEEP_OUTPUT.parse(JSON.stringify({ entries: ["one line\ntwo lines"] })),
    ).toThrow(/failed schema validation/);
  });
});

describe("a refused response", () => {
  it("rides on the error, so the lane that catches it can write it somewhere durable", () => {
    const response = JSON.stringify({ entries: ["one line\ntwo lines"] });

    try {
      SEAM_SWEEP_OUTPUT.parse(response);
      expect.unreachable("the schema should have refused this");
    } catch (err) {
      expect(rejectedResponse(err)).toBe(response);
    }
  });

  it("is undefined for anything that is not a refused response, which a lane rethrows untouched", () => {
    expect(rejectedResponse(new Error("could not spawn `claude`"))).toBeUndefined();
  });
});
