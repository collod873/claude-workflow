import type { ZodTypeDef, ZodType } from "zod";
import { reason } from "./reason";

const OPEN_TAG = "<output>";
const CLOSE_TAG = "</output>";

/**
 * Extracts and validates the single `<output>` block a stage's raw agent
 * response must end in.
 *
 * A raw agent response goes in — the model's full stdout. A typed, validated
 * value comes out, or this throws naming exactly what was wrong: the block is
 * missing (or there is more than one), it isn't the last thing in the
 * response, its contents aren't valid JSON, or the parsed JSON fails
 * `schema`. There is no repair pass and no retry — a stage this rejects has
 * failed, full stop.
 */
export function extractOutput<T>(raw: string, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const openCount = countOccurrences(raw, OPEN_TAG);
  const closeCount = countOccurrences(raw, CLOSE_TAG);

  if (openCount === 0 || closeCount === 0) {
    throw new Error(
      "response has no <output> block: expected the response to end in a single <output>...</output> block",
    );
  }
  if (openCount > 1 || closeCount > 1) {
    throw new Error(
      `response has ${Math.max(openCount, closeCount)} <output> blocks, expected exactly one`,
    );
  }

  const openIndex = raw.indexOf(OPEN_TAG);
  const closeIndex = raw.indexOf(CLOSE_TAG);
  if (closeIndex < openIndex) {
    throw new Error("response has a </output> tag that closes before its <output> tag opens");
  }

  const trailing = raw.slice(closeIndex + CLOSE_TAG.length);
  if (trailing.trim().length > 0) {
    throw new Error(
      "response does not end in its <output> block: content follows </output>",
    );
  }

  const jsonText = raw.slice(openIndex + OPEN_TAG.length, closeIndex);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const detail = reason(err);
    throw new Error(`<output> block is not valid JSON: ${detail}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`<output> block failed schema validation: ${result.error.message}`);
  }

  return result.data;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
