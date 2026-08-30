import path from "node:path";
import { describe, expect, it } from "vitest";
import { moduleUrl, probeResult, runTsx } from "./237-spec-pass.fixture";
import { expectVitestPasses } from "./261-spec-sweep.fixture";
import {
  SHAPE_SOURCE,
  SHAPE_SUITE_ARG,
  SHARED_HANDOFF_PATH_SOURCE,
  linesMentioning,
  readSource,
  shapeCode,
} from "./273-shape.fixture";

/**
 * #273, criterion 3.
 *
 * "Still passes" is half the claim and "against the shared handoff-path import" is the other half:
 * the shape suite is green today, so a test that only ran it would be green today too and would
 * never say anything about this ticket. So the import is read out of `shape.ts` first — the lane has
 * to be taking `handoffPath` from `shared/handoff-path` rather than declaring one — and the shared
 * module is then driven out of process to check it is the reconciliation both lanes need, before the
 * suite itself is run.
 *
 * The module is reached the way a shell reaches it, by absolute file URL inside a child process,
 * because nothing in this directory may import outward.
 */

/** A handoff path a run would never derive by accident, so the env branch is unmistakable. */
const FROM_ENV = path.join("/tmp", "acceptance-273", "failure-reason.txt");

const HANDOFF_PROBE = `
const MODULE = process.env.PROBE_MODULE;
(async () => {
  let value = null;
  let error = null;
  try {
    const mod = await import(MODULE);
    if (typeof mod.handoffPath !== "function") {
      error = "shared/handoff-path.ts exports no handoffPath function";
    } else {
      value = String(mod.handoffPath());
    }
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  console.log("PROBE:" + JSON.stringify({ value: value, error: error }));
})();
`;

interface HandoffProbe {
  value: string | null;
  error: string | null;
}

/**
 * `handoffPath()` as the shared module resolves it under `FAILURE_REASON_PATH` set to
 * `failureReasonPath`. An empty string is the unset venue: the reconciliation the two copies do
 * today falls back whenever the variable carries nothing.
 */
function handoffPathUnder(failureReasonPath: string): HandoffProbe {
  return probeResult<HandoffProbe>(
    runTsx(HANDOFF_PROBE, {
      PROBE_MODULE: moduleUrl(SHARED_HANDOFF_PATH_SOURCE),
      FAILURE_REASON_PATH: failureReasonPath,
    }),
  );
}

/** The named bindings each `import`/`export ... from "..."` in `code` takes, by specifier. */
function namedImports(code: string): Array<{ specifier: string; names: string[] }> {
  const pattern = /(?:import|export)\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;
  const found: Array<{ specifier: string; names: string[] }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const names = match[1]
      .split(",")
      .map((entry) => entry.replace(/\btype\b/, "").split(" as ")[0].trim())
      .filter((entry) => entry.length > 0);
    found.push({ specifier: match[2], names });
  }

  return found;
}

describe("#273 — the shape suite runs against the shared handoff path", () => {
  // - [ ] The existing shape suite still passes against the shared handoff-path import — check: `npx vitest run .Workflow/agent-workflows/shape`
  it(
    "The existing shape suite still passes against the shared handoff-path import — check: `npx vitest run .Workflow/agent-workflows/shape`",
    () => {
      const raw = readSource(SHAPE_SOURCE);
      expect(raw, `${SHAPE_SOURCE} does not exist`).not.toBe("");

      const code = shapeCode();
      const imports = namedImports(code);
      const shared = imports.filter(
        (entry) => /(?:^|\/)shared\/handoff-path(?:\.[jt]s)?$/.test(entry.specifier),
      );

      expect(
        shared.map((entry) => entry.specifier),
        `shape.ts imports from ${imports.map((entry) => entry.specifier).join(", ") || "nothing"}, none of which is shared/handoff-path`,
      ).not.toEqual([]);

      expect(
        shared.some((entry) => entry.names.includes("handoffPath")),
        `shape.ts's shared/handoff-path import takes ${shared
          .flatMap((entry) => entry.names)
          .join(", ")} rather than handoffPath`,
      ).toBe(true);

      const declared = [
        ...linesMentioning(code, "handoffPath").filter((line) =>
          /(?:function\s+handoffPath\s*\(|(?:const|let|var)\s+handoffPath\s*=)/.test(line),
        ),
      ];
      expect(
        declared,
        `shape.ts still declares a handoffPath of its own:\n${declared.join("\n")}`,
      ).toEqual([]);

      const fromEnv = handoffPathUnder(FROM_ENV);
      expect(fromEnv.error, `the shared handoff path could not be run: ${fromEnv.error}`).toBe(null);
      expect(
        fromEnv.value,
        "the shared handoffPath ignores FAILURE_REASON_PATH, so the runner and a local run would disagree",
      ).toBe(FROM_ENV);

      const fallback = handoffPathUnder("");
      expect(fallback.error, `the shared handoff path could not be run: ${fallback.error}`).toBe(
        null,
      );
      expect(
        fallback.value ?? "",
        `with FAILURE_REASON_PATH unset the shared handoffPath resolved to ${String(fallback.value)}`,
      ).toMatch(/handoff\.txt$/);
      expect(
        path.isAbsolute(fallback.value ?? ""),
        `the shared handoffPath's fallback ${String(fallback.value)} is not repo-relative`,
      ).toBe(false);

      expectVitestPasses(SHAPE_SUITE_ARG);
    },
    900_000,
  );
});
