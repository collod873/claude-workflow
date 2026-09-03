import { describe, expect, it } from "vitest";
import { binSources, laneSources } from "./repo-sources";

/**
 * CODING_STANDARDS.md, "Pin a mandated copy to its source". Two readers decide what a
 * `test.fails(` / `it.fails(` marker is, and they have to agree: `implement/implement.ts`'s
 * `sliceMarker` picks the slice's own acceptance tests for the implementer's brief, and
 * `bin/close-ticket`'s `FAILS_LINE_RE` + `number_re` refuse a close while such a line survives
 * (#360). One is TypeScript and one is Python, so no compiler looks across the boundary — and if
 * they drift, a ticket is either briefed with tests it will not be allowed to close on, or closed
 * with a marker the brief never showed the implementer.
 *
 * Both grammars are read as *text*, out of the two files that own them, because that is the only
 * form the two languages share.
 */

/** The one deliberate difference: the TypeScript reader scans a whole file, so it spans the title itself; the Python one already has a single line in hand. */
const WITHIN_THE_LINE = "[^\\n]*";

const sourceOf = (files: { relative: string; source: string }[], relative: string) => files.find((file) => file.relative === relative)?.source ?? "";

/**
 * `sliceMarker`'s pattern with its TypeScript string escaping undone, split at the ticket number
 * it interpolates — `{ marker, boundary }`, the two halves the Python side spells separately.
 */
function typescriptGrammar(): { marker: string; boundary: string } | undefined {
  const literal = /new RegExp\(`([^`]*)`/.exec(sourceOf(laneSources(), ".Workflow/agent-workflows/implement/implement.ts"))?.[1];
  const [marker, boundary] = (literal?.replaceAll("\\\\", "\\") ?? "").split("#${issueNumber}");
  return boundary === undefined ? undefined : { marker, boundary };
}

/** The same two halves as `bin/close-ticket` spells them — `FAILS_LINE_RE`'s pattern, and what `number_re` puts after the ticket number. */
function pythonGrammar(): { marker: string; boundary: string } | undefined {
  const source = sourceOf(binSources(), "bin/close-ticket");
  const marker = /^FAILS_LINE_RE = re\.compile\(r"(.*)"\)$/m.exec(source)?.[1];
  const boundary = /^\s*number_re = re\.compile\(rf"#\{re\.escape\(issue\)\}(.*)"\)$/m.exec(source)?.[1];
  return marker === undefined || boundary === undefined ? undefined : { marker, boundary };
}

describe("implement.ts's test.fails( marker agrees with the bin/close-ticket grammar it is a copy of", () => {
  const typescript = typescriptGrammar();
  const python = pythonGrammar();

  it("finds a grammar in each file, so this pin is not vacuous", () => {
    expect(typescript, "implement.ts's sliceMarker pattern").toBeDefined();
    expect(python, "bin/close-ticket's FAILS_LINE_RE and number_re").toBeDefined();
  });

  it("anchors a marker to statement start the same way in both languages", () => {
    expect(typescript?.marker, "implement.ts's sliceMarker, up to the ticket number").toBe(`${python?.marker}${WITHIN_THE_LINE}`);
  });

  it("ends the ticket number the same way in both languages, so neither reads #36 as #360", () => {
    expect(typescript?.boundary, "implement.ts's sliceMarker, after the ticket number").toBe(python?.boundary);
  });
});
