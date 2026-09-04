import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AUTHOR_OUTPUT } from "../acceptance/acceptance";
import { IMPLEMENTER_OUTPUT } from "../implement/implement";
import { REFUTER_OUTPUT, SHAPER_OUTPUT } from "./sheet-schema";
import { SWEEP_OUTPUT } from "./sweep-schema";
import { SEAM_SWEEP_OUTPUT } from "../to-tickets/seam-sweep/schema";
import { RATIFIER_OUTPUT } from "../ratify/verdict-schema";
import { AUDIT_OUTPUT, Plan, SLICE_CAPS, SLICE_OUTPUT } from "./plan-schema";
import { promptSource } from "./prompts.fixture";
import { validateCriteriaShape, validatePathsAreRooted } from "./render-body";
import type { StructuredOutput } from "./structured-output";

const PROMPTS: ReadonlyArray<{ path: string; output: StructuredOutput<unknown> }> = [
  { path: "shape/sweep/prompt.md", output: SWEEP_OUTPUT },
  { path: "shape/shaper/prompt.md", output: SHAPER_OUTPUT },
  { path: "shape/refuter/prompt.md", output: REFUTER_OUTPUT },
  { path: "to-tickets/seam-sweep/prompt.md", output: SEAM_SWEEP_OUTPUT },
  { path: "to-tickets/slice/prompt.md", output: SLICE_OUTPUT },
  { path: "to-tickets/audit/prompt.md", output: AUDIT_OUTPUT },
  { path: "ratify/prompt.md", output: RATIFIER_OUTPUT },
  { path: "acceptance/author/prompt.md", output: AUTHOR_OUTPUT },
  { path: "implement/implementer/prompt.md", output: IMPLEMENTER_OUTPUT },
  { path: "implement/implementer/fresh-eyes.md", output: IMPLEMENTER_OUTPUT },
];

function skeletons(promptPath: string): unknown[] {
  const source = promptSource(promptPath);
  const found = [...source.matchAll(/^```structured-output\n([\s\S]*?)\n```$/gm)];
  return found.map((match) => JSON.parse(match[1]) as unknown);
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = schema._def as { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny };
  if (def.innerType) return unwrap(def.innerType);
  if (def.schema) return unwrap(def.schema);
  return schema;
}

function objectArrayPaths(schema: z.ZodTypeAny, path: string[] = []): string[][] {
  const node = unwrap(schema);
  const def = node._def as {
    typeName?: string;
    type?: z.ZodTypeAny;
    options?: z.ZodTypeAny[];
  };

  if (node instanceof z.ZodArray) {
    const element = unwrap(def.type as z.ZodTypeAny);
    if (element instanceof z.ZodObject) {
      return [path, ...objectArrayPaths(element, path)];
    }
    return [];
  }

  if (node instanceof z.ZodObject) {
    const shape = node.shape as Record<string, z.ZodTypeAny>;
    return Object.keys(shape).flatMap((key) => objectArrayPaths(shape[key], [...path, key]));
  }

  if (def.options) {
    return def.options.flatMap((option) => objectArrayPaths(option, path));
  }

  return [];
}

function arraysAt(value: unknown, path: string[]): unknown[][] {
  if (path.length === 0) return Array.isArray(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => arraysAt(item, path));
  if (value === null || typeof value !== "object") return [];
  const next = (value as Record<string, unknown>)[path[0]];
  return next === undefined ? [] : arraysAt(next, path.slice(1));
}

describe.each(PROMPTS)("$path", ({ path, output }) => {
  it("shows only skeletons the stage's own schema accepts", () => {
    const shown = skeletons(path);
    expect(shown.length).toBeGreaterThan(0);
    for (const skeleton of shown) {
      expect(() => output.parse(JSON.stringify(skeleton))).not.toThrow();
    }
  });

  it("populates every array of objects it asks for, so no field's shape is left to prose", () => {
    const shown = skeletons(path);
    const unpopulated = objectArrayPaths(output.schema).filter((expected) =>
      shown.every((skeleton) =>
        arraysAt(skeleton, expected).every((found) => found.length === 0),
      ),
    );

    expect(unpopulated.map((segments) => segments.join(".") || "(the response itself)")).toEqual(
      [],
    );
  });
});

describe("the Slice caps, on the wire and in both prompts", () => {
  const wireSlices: ReadonlyArray<{ stage: string; properties: Record<string, Record<string, unknown>> }> = [
    { stage: "slice", properties: sliceProperties(SLICE_OUTPUT) },
    { stage: "audit", properties: sliceProperties(AUDIT_OUTPUT) },
  ];

  function sliceProperties(output: StructuredOutput<unknown>) {
    const schema = JSON.parse(output.jsonSchema) as {
      properties: { slices: { items: { properties: Record<string, Record<string, unknown>> } } };
    };
    return schema.properties.slices.items.properties;
  }

  const PLAN_PROMPTS = ["to-tickets/slice/prompt.md", "to-tickets/audit/prompt.md"] as const;

  it.each(wireSlices)("$stage: the derived JSON Schema carries maxLength on all three prose fields", ({ properties }) => {
    expect(properties.whatToBuild.maxLength).toBe(SLICE_CAPS.whatToBuild);
    expect(properties.whyNotMerged.maxLength).toBe(SLICE_CAPS.whyNotMerged);
    expect((properties.acceptanceCriteria.items as Record<string, unknown>).maxLength).toBe(
      SLICE_CAPS.acceptanceCriteria,
    );
  });

  it.each(wireSlices)("$stage: neither filesClaimed nor acceptanceCriteria carries an item-count cap", ({ properties }) => {
    expect(properties.filesClaimed).not.toHaveProperty("maxItems");
    expect(properties.acceptanceCriteria).not.toHaveProperty("maxItems");
  });

  it.each(PLAN_PROMPTS)("%s shows an example the publisher would accept", (promptPath) => {
    for (const skeleton of skeletons(promptPath)) {
      const plan = Plan.parse((skeleton as { slices: unknown }).slices);
      expect(() => validatePathsAreRooted(plan)).not.toThrow();
      expect(() => validateCriteriaShape(plan)).not.toThrow();
    }
  });

  it.each(PLAN_PROMPTS)("%s states each cap beside the field it bounds", (promptPath) => {
    const source = promptSource(promptPath);
    for (const [field, cap] of Object.entries(SLICE_CAPS)) {
      expect(source).toMatch(new RegExp(`\`${field}\`[^\\n]*\\b${cap}\\b`));
    }
  });
});
