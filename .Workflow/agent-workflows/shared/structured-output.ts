import { z, type ZodType, type ZodTypeDef } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { reason } from "./reason";

export interface StructuredOutput<T> {
  jsonSchema: string;
  schema: z.ZodTypeAny;
  parse(responseText: string): T;
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly responseText: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

export function rejectedResponse(err: unknown): string | undefined {
  return err instanceof StructuredOutputError ? err.responseText : undefined;
}

export function structuredOutput<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  wrapIn?: string,
): StructuredOutput<T> {
  const rooted: z.ZodTypeAny =
    wrapIn === undefined ? (schema as z.ZodTypeAny) : z.object({ [wrapIn]: schema });

  return {
    jsonSchema: JSON.stringify(deriveJsonSchema(rooted, wrapIn)),
    schema: rooted,
    parse(responseText) {
      const value = rooted.safeParse(parseJson(responseText));
      if (!value.success) {
        throw new StructuredOutputError(
          `structured output failed schema validation: ${value.error.message}`,
          responseText,
        );
      }
      return (wrapIn === undefined
        ? value.data
        : (value.data as Record<string, unknown>)[wrapIn]) as T;
    },
  };
}

function deriveJsonSchema(schema: z.ZodTypeAny, wrapIn: string | undefined): unknown {
  const derived = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
  delete derived.$schema;

  if (derived.type !== "object") {
    throw new Error(
      `a stage's JSON Schema must be object-rooted, but this one derives to ${JSON.stringify(derived.type ?? null)}` +
        (wrapIn === undefined ? " — pass `wrapIn` to nest it under a field" : ""),
    );
  }
  return derived;
}

function parseJson(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch (err) {
    throw new StructuredOutputError(
      `structured output is not valid JSON: ${reason(err)}`,
      responseText,
    );
  }
}
