import { describe, expect, it } from "vitest";
import {
  TIMING_BASELINE,
  chosenAttempt,
  describeProbe,
  regenerateProbe,
  seededMatching,
} from "./349-timing-baseline.fixture";

/** Keys that name the artifact's own format rather than a measurement of a venue. */
const NOT_A_MEASUREMENT = /^(version|schema|schemaversion|revision|format)$/i;

function lastSegment(keyPath: string): string {
  const parts = keyPath.split(".");
  return parts[parts.length - 1].replace(/\[\d+\]$/, "");
}

/**
 * Every figure a parsed baseline carries, as `path=value` — numbers, and strings that are nothing
 * but a number, which is the other way a duration gets written into JSON.
 *
 * Shape-tolerant on purpose: the ticket says the seeded baseline is in the ratchet's "no entry yet"
 * state, and says nothing about how that state is spelled. What it does say is that no figure
 * measured somewhere else rides in with it, and a figure is a figure wherever the artifact hangs it.
 * A format key is not a measurement, so those are passed over.
 */
function measuredFigures(value: unknown, keyPath = ""): string[] {
  if (keyPath !== "" && NOT_A_MEASUREMENT.test(lastSegment(keyPath))) return [];
  const where = keyPath === "" ? "(root)" : keyPath;

  if (typeof value === "number") return [`${where}=${String(value)}`];
  if (typeof value === "string") {
    return /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? [`${where}=${value}`] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => measuredFigures(entry, `${keyPath}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      measuredFigures(entry, keyPath === "" ? key : `${keyPath}.${key}`),
    );
  }
  return [];
}

/**
 * ADR-0140's rule is that an enrolled repository inherits its own history rather than a figure
 * written for it, and a seeded baseline is where that starts: it arrives empty — the ratchet's
 * "no entry yet, recorded rather than judged" state — so the target's own first venue run is what
 * puts a number in it.
 *
 * So what is read here is the seeded artifact's contents: it parses, and it carries no measurement
 * at all.
 */
describe("the baseline regenerate-artifacts seeds", () => {
  // A seeded baseline arrives in the "no entry yet, recorded rather than judged" state rather than
  // carrying a figure measured somewhere else, so the target's first venue run is what fills it —
  // check: `npx vitest run .Workflow/agent-workflows/implement/regenerate-artifacts.test.ts`
  it("arrives with no entry yet rather than carrying a figure measured somewhere else", () => {
    const probe = regenerateProbe();
    const attempt = chosenAttempt(probe);
    const seeded = seededMatching(attempt?.seeded ?? [], TIMING_BASELINE);

    expect(
      seeded.length > 0
        ? "a timing baseline was seeded"
        : `no timing baseline was seeded at the target.\n${describeProbe(probe)}`,
    ).toBe("a timing baseline was seeded");

    const where = seeded[0] ?? "";
    const text = attempt?.texts[where] ?? "";

    let parsed: unknown;
    let parseError: string | null = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }

    expect(
      parseError === null
        ? "the seeded baseline parses"
        : `${where} is not JSON: ${parseError}\n${text.slice(0, 2000)}`,
    ).toBe("the seeded baseline parses");

    // Nothing measured: the first venue run is what fills it.
    expect(measuredFigures(parsed)).toEqual([]);
  });
});
