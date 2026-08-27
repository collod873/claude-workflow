import { z, type ZodType, type ZodTypeDef } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { reason } from "./reason";

/**
 * What a stage returns its answer through: the JSON Schema handed to
 * `claude --json-schema`, and the parse that turns the CLI's validated
 * structured output back into the stage's own type.
 *
 * **Why this exists at all.** A stage used to hand-type its answer into an
 * `<output>` block and a parser read it back off the transcript, which made
 * every stage's answer only as good as the model's bracket counting. Run
 * 33112792733 spent 24 minutes and about a dollar slicing #145 and died on
 * one slip in slice 23 of 26 — a closing `]` dropped and a whole field with
 * it. The other 25 slices were correct and the grading notes were good work;
 * all of it was discarded.
 *
 * `--json-schema` moves that check to the tool-call boundary. The CLI injects
 * a `StructuredOutput` tool built from this schema, and the model's answer is
 * that tool's input — validated by the API before it ever reaches this
 * process, while the model is still around to be told it got it wrong. What
 * the model can no longer do is corrupt a payload it is not the one
 * serialising.
 */
export interface StructuredOutput<T> {
  /**
   * The JSON Schema, as the string that goes on argv. Derived from `schema`
   * rather than written beside it — a second copy kept in sync by hope is
   * exactly the drift `.claude/contract.json` is generated to avoid
   * (ADR-0056).
   */
  jsonSchema: string;
  /**
   * The object-rooted zod schema the response is validated against — the
   * wrapper included, when there is one. Exposed so `prompt-skeleton.test.ts`
   * can check each prompt's skeleton against the shape the stage will
   * actually be asked for, rather than against the unwrapped domain schema
   * the model never sees.
   */
  schema: z.ZodTypeAny;
  /**
   * Validates one response and returns the stage's value, unwrapped. Throws
   * naming what was wrong — not valid JSON, or valid JSON the schema refuses.
   * There is no repair pass and no retry: a response this rejects has failed
   * the stage.
   */
  parse(responseText: string): T;
}

/**
 * A response `parse` refused, carrying the text it refused.
 *
 * The text rides on the error because the stage that produced it is gone by
 * the time anyone reads the failure: #42 could not be diagnosed from the run
 * that raised it — two minutes of model time left exactly one line, and the
 * response it described died with the stack. A lane catches this, writes the
 * text somewhere durable, and names the path in what it rethrows.
 */
export class StructuredOutputError extends Error {
  constructor(
    message: string,
    /** Exactly what the CLI returned, unparsed and untruncated. */
    readonly responseText: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/**
 * The refused text an error carries, or `undefined` for any error that is not
 * a refused response — a dead CLI, a bad spawn — which a lane should rethrow
 * untouched rather than file as a model's bad answer.
 */
export function rejectedResponse(err: unknown): string | undefined {
  return err instanceof StructuredOutputError ? err.responseText : undefined;
}

/**
 * Builds a stage's structured-output contract from its zod schema.
 *
 * **The root must be an object.** An array root is refused by the API with
 * `tools.N.custom.input_schema.type: Input should be 'object'` — a 400 that
 * arrives after the stage has spawned, names no stage, and costs whatever the
 * model had already spent. `wrapIn` is the way past it: pass a field name and
 * the schema is nested under it, so `Plan` (a bare array) goes on the wire as
 * `{"slices": [...]}` and comes back off it as a `Plan` again. A schema that
 * is object-rooted already passes no `wrapIn`; one that isn't and doesn't is
 * refused **here**, at construction, where the message can say which schema
 * and what to do about it.
 *
 * **What JSON Schema cannot carry still holds.** zod refinements have no JSON
 * Schema form — `SeamManifestEntry`'s "no newline characters" is a predicate,
 * not a keyword — so `zodToJsonSchema` silently drops them. That is why
 * `parse` runs the zod schema over the structured output rather than trusting
 * the API's validation to have been the whole check: the API enforces the
 * shape, zod enforces the rest.
 */
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

/**
 * `zodToJsonSchema`'s output, trimmed to what a tool input schema may be and
 * checked for the one property the API insists on.
 *
 * `$refStrategy: "none"` inlines every reused subschema rather than emitting
 * `$ref`/`definitions`: a tool input schema is read on its own, and a
 * `definitions` block hanging off the root is a document convention rather
 * than part of the shape. `$schema` goes for the same reason — the API is
 * being handed a shape, not a standalone JSON Schema document.
 */
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
    // Reached when the CLI answered without structured output at all — the
    // flag dropped off the argv, or a run that failed in a way that still
    // exited 0 — in which case `responseText` is the model's prose and this
    // is the first place that shows. Named rather than left as a bare
    // `SyntaxError` about position 0, which says nothing about the stage.
    throw new StructuredOutputError(
      `structured output is not valid JSON: ${reason(err)}`,
      responseText,
    );
  }
}
