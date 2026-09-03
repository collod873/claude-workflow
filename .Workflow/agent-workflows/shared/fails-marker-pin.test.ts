import { describe, expect, it } from "vitest";
import { binSources, laneSources } from "./repo-sources";

const WITHIN_THE_LINE = "[^\\n]*";

const sourceOf = (files: { relative: string; source: string }[], relative: string) => files.find((file) => file.relative === relative)?.source ?? "";

function typescriptGrammar(): { marker: string; boundary: string } | undefined {
  const literal = /new RegExp\(`([^`]*)`/.exec(sourceOf(laneSources(), ".Workflow/agent-workflows/implement/implement.ts"))?.[1];
  const [marker, boundary] = (literal?.replaceAll("\\\\", "\\") ?? "").split("#${issueNumber}");
  return boundary === undefined ? undefined : { marker, boundary };
}

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
