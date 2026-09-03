import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { combinedOutput, runFromRoot } from "./276-required-stage.fixture";
import {
  TIMINGS_ARTIFACT,
  TIMINGS_ARTIFACT_RELATIVE,
  isNestedRun,
  runGuarded,
} from "./357-timing.fixture";

/**
 * #357, criterion 5 — what replaces the judged baseline: a file every run writes and nothing reads
 * a verdict out of.
 *
 * The artefact is removed before the run, so what is asserted afterwards is what *this* run wrote
 * rather than what some earlier one left behind. The run's own exit status is ignored, exactly as
 * the criterion's own check ignores it with a `;` — the ticket says the durations are written
 * whether or not the venue passed, and whether or not anything collects them.
 *
 * **What is read out of the payload, and what is not.** The criterion names three things the file
 * carries — the venue, the wall time, the per-check times — and names no key for any of them, so
 * the payload is walked rather than indexed: some string in it is the venue that was run, some
 * number in it is a duration, and the per-check times are either a container of their own or enough
 * numbers that they cannot all be the wall and the core count. Spelling a key here would be pinning
 * something the ticket left open, and the implementer is reading the same sentence.
 *
 * The gitignore half is asked of git rather than of `.gitignore`'s text, because being ignored is
 * what the criterion asserts and a rule can be written in more than one place.
 */

interface Leaves {
  numbers: number[];
  strings: string[];
}

/** Every number and every string — keys included — anywhere in a parsed payload. */
function collect(value: unknown, out: Leaves): void {
  if (typeof value === "number") {
    out.numbers.push(value);
    return;
  }
  if (typeof value === "string") {
    out.strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out.strings.push(key);
      collect(nested, out);
    }
  }
}

function leavesOf(value: unknown): Leaves {
  const out: Leaves = { numbers: [], strings: [] };
  collect(value, out);
  return out;
}

/** The payload's own second level — where a per-check breakdown would sit. */
function children(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload !== null && typeof payload === "object") {
    return Object.values(payload as Record<string, unknown>);
  }
  return [];
}

/**
 * Whether the payload carries per-check times: a nested container holding durations of its own, or
 * — for a run that writes them flat beside the venue — more numbers than a wall time and a core
 * count could account for.
 */
function carriesPerCheckTimes(payload: unknown): boolean {
  const nested = children(payload).filter(
    (child) => child !== null && typeof child === "object",
  );
  if (nested.some((child) => leavesOf(child).numbers.length > 0)) return true;
  return leavesOf(payload).numbers.length >= 3;
}

describe("#357 the durations a gauntlet run writes", () => {
  // A gauntlet run leaves `.gauntlet-timings.json` at the target root carrying the venue, the wall
  it(
    "leaves .gauntlet-timings.json at the target root, gitignored, carrying venue and times",
    () => {
      // Inside a check one of these criteria already spawned, running the gauntlet again would be a
      // run that re-enters itself; the outer run is the one that judges.
      if (isNestedRun()) return;

      rmSync(TIMINGS_ARTIFACT, { force: true, recursive: true });

      const run = runGuarded("bin/gauntlet", ["turn"], 900_000, { GAUNTLET_TIMING: "on" });

      expect(
        existsSync(TIMINGS_ARTIFACT),
        `\`GAUNTLET_TIMING=on bin/gauntlet turn\` left no ${TIMINGS_ARTIFACT_RELATIVE}:\n` +
          combinedOutput(run),
      ).toBe(true);

      const text = readFileSync(TIMINGS_ARTIFACT, "utf8");
      expect(text.trim().length, `${TIMINGS_ARTIFACT_RELATIVE} is empty`).toBeGreaterThan(0);

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        expect.fail(`${TIMINGS_ARTIFACT_RELATIVE} is not JSON (${reason}):\n${text}`);
      }

      const leaves = leavesOf(payload);

      expect(
        leaves.strings.some((value) => /\bturn\b/i.test(value)),
        `${TIMINGS_ARTIFACT_RELATIVE} does not record which venue ran:\n${text}`,
      ).toBe(true);

      expect(
        leaves.numbers.some((value) => value > 0),
        `${TIMINGS_ARTIFACT_RELATIVE} records no wall time:\n${text}`,
      ).toBe(true);

      expect(
        carriesPerCheckTimes(payload),
        `${TIMINGS_ARTIFACT_RELATIVE} records no per-check times:\n${text}`,
      ).toBe(true);

      const ignored = runFromRoot("git", ["check-ignore", "-q", TIMINGS_ARTIFACT_RELATIVE], 60_000);
      expect(
        ignored.status,
        `${TIMINGS_ARTIFACT_RELATIVE} is not gitignored:\n${combinedOutput(ignored)}`,
      ).toBe(0);
    },
    1_200_000,
  );
});
