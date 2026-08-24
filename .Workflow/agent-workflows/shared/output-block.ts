import type { ZodTypeDef, ZodType } from "zod";
import { reason } from "./reason";

const OPEN_TAG = "<output>";
const CLOSE_TAG = "</output>";

/**
 * How `extractOutput` reports a response it accepted but had something to
 * say about — today, only that the payload carried extra `<output>` tags.
 * Defaulted to `console.warn` rather than left optional at the call site,
 * so the one thing this must never be is silent: an accepted-with-a-caveat
 * response says so in the run log whether or not the caller remembered to
 * ask.
 */
export type OutputReport = (note: string) => void;

/**
 * Extracts and validates the `<output>` block a stage's raw agent response
 * must end in.
 *
 * A raw agent response goes in — the model's full stdout. A typed, validated
 * value comes out, or this throws naming exactly what was wrong: the block is
 * missing, it isn't the last thing in the response, its contents aren't valid
 * JSON, or the parsed JSON fails `schema`. There is no repair pass and no
 * retry — a stage this rejects has failed, full stop.
 *
 * **The block is the outermost span, not the innermost.** It runs from the
 * *first* `<output>` to the *last* `</output>`, and everything between is the
 * payload — tags included. That is deliberate, and it is what #42 fixed: the
 * old contract counted `<output>` occurrences across the whole response and
 * refused anything but one, which meant a stage failed whenever its answer
 * so much as mentioned the tag. Seam sweep hit this on its third run against
 * #36 by doing its job correctly — this repo's own `<output>` contract is a
 * shared shape, so naming it in a manifest entry put the literal tag inside
 * the payload, and the parse rejected a well-formed answer (run 32677530530,
 * and `seam-sweep-payload-tags.evidence.txt` beside this file).
 *
 * Taking the *last* block instead — the obvious patch — would have been
 * worse than the bug: in every captured failure the trailing `<output>` sits
 * mid-string inside the JSON, so slicing from it yields garbage. What makes
 * the outermost span safe is that nothing here has to guess: `JSON.parse` and
 * `schema` are the proof the span was the right one. A response with two
 * genuine blocks does not parse, and is still rejected — with the interior
 * tags named in the message, so the next reader doesn't repeat #42's
 * investigation from scratch.
 */
export function extractOutput<T>(
  raw: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  report: OutputReport = console.warn,
): T {
  const openIndex = raw.indexOf(OPEN_TAG);
  const closeIndex = raw.lastIndexOf(CLOSE_TAG);

  if (openIndex === -1 || closeIndex === -1 || closeIndex < openIndex) {
    throw new Error(
      "response has no <output> block: expected the response to end in a single <output>...</output> block",
    );
  }

  const trailing = raw.slice(closeIndex + CLOSE_TAG.length);
  if (trailing.trim().length > 0) {
    throw new Error("response does not end in its <output> block: content follows </output>");
  }

  const jsonText = raw.slice(openIndex + OPEN_TAG.length, closeIndex);
  const extra = describeInteriorTags(jsonText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const detail = reason(err);
    // The tag census rides along on the failure, not just the success: two
    // genuine blocks land here, and "not valid JSON" alone would send the
    // reader looking at the model's JSON rather than at the extra block
    // that made the span span too much.
    const suffix = extra === undefined ? "" : ` (the block ${extra})`;
    throw new Error(`<output> block is not valid JSON: ${detail}${suffix}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`<output> block failed schema validation: ${result.error.message}`);
  }

  if (extra !== undefined) {
    report(`<output> block accepted; it ${extra} inside its payload, read as content`);
  }

  return result.data;
}

/**
 * Counts the `<output>`/`</output>` tags sitting inside an extracted block
 * and describes them as a clause both the success report and the JSON
 * failure embed — or `undefined` when there are none, which is the ordinary
 * case and says nothing.
 */
function describeInteriorTags(jsonText: string): string | undefined {
  const count = countOccurrences(jsonText, OPEN_TAG) + countOccurrences(jsonText, CLOSE_TAG);
  if (count === 0) {
    return undefined;
  }
  return `carries ${count} extra <output> tag${count === 1 ? "" : "s"}`;
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
