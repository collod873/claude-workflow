import { describe, expect, it } from "vitest";
import { writtenTwice } from "./written-twice.ts";

const source = (file: string, ...lines: string[]) => ({ file, text: lines.join("\n") });
const ASK = "export the text from one owner and build the other side from it";

describe("written twice refuses text the machine spells in two places, so renaming one side cannot silently break the other (#912)", () => {
  it("refuses a pattern whose literal words are written somewhere else, naming both places", () => {
    expect(writtenTwice([
      source("src/writer.ts", "export const note = (n: number) => `## Wave ${n}`;"),
      source("src/reader.ts", "", "", "export const WAVE = /^## Wave (\\d+)$/m;"),
    ])).toEqual([`written twice: src/reader.ts:3 reads "## Wave " that src/writer.ts:1 writes; ${ASK}`]);
  });

  it("counts a pattern built from a template by its literal parts", () => {
    expect(writtenTwice([
      source("src/writer.ts", 'export const SAID = "its builder split it into parts";'),
      source("src/reader.ts", "export const said = (n: string) => new RegExp(`its builder split it ${n}`);"),
    ])).toEqual([`written twice: src/reader.ts:1 reads "its builder split it " that src/writer.ts:1 writes; ${ASK}`]);
  });

  it("refuses the same pattern written out in two files", () => {
    expect(writtenTwice([
      source("src/one.ts", "export const URL = /\\/issues\\/(\\d+)$/;"),
      source("src/two.ts", "", "export const NUMBER = /\\/issues\\/(\\d+)$/;"),
    ])).toEqual([`written twice: src/one.ts:1 and src/two.ts:2 spell the same pattern /\\/issues\\/(\\d+)$/; ${ASK}`]);
  });

  it("refuses the same text declared as a top-level constant in two files", () => {
    expect(writtenTwice([
      source("src/one.ts", 'const SPEC = "spec";', "export const one = SPEC;"),
      source("src/two.ts", 'export const LABEL = "spec";'),
    ])).toEqual([`written twice: src/one.ts:1 and src/two.ts:1 declare the same constant "spec"; ${ASK}`]);
  });

  it("refuses a writer and its pattern in one file once they sit more than two lines apart", () => {
    const apart = source("src/one.ts", 'export const say = () => "its review found a gap";', "", "", "export const SEEN = /its review found/;");
    const beside = source("src/one.ts", 'export const say = () => "its review found a gap";', "", "export const SEEN = /its review found/;");

    expect(writtenTwice([apart])).toEqual([`written twice: src/one.ts:4 reads "its review found" that src/one.ts:1 writes; ${ASK}`]);
    expect(writtenTwice([beside])).toEqual([]);
  });

  it("stays quiet on tests, part files and the shared scenarios, which fake GitHub's and git's text on purpose", () => {
    const reader = source("src/reader.ts", "export const WAVE = /^## Wave (\\d+)$/m;");

    for (const file of ["src/reader.test.ts", "src/reader.proc.test.ts", "src/reader.part.ts", "src/scenarios.ts"]) {
      expect(writtenTwice([reader, source(file, "export const note = `## Wave 1`;", "export const WAVE = /^## Wave (\\d+)$/m;", 'const SPEC = "spec";')])).toEqual([]);
    }
    expect(writtenTwice([source("src/one.ts", 'const SPEC = "spec";'), source("src/one.test.ts", 'const SPEC = "spec";')])).toEqual([]);
  });

  it("stays quiet on a pattern reading text only GitHub or git writes, and on short patterns", () => {
    expect(writtenTwice([
      source("src/one.ts", "export const MISSING = /HTTP 404/;", "export const parts = (text: string) => text.split(/,\\s*/);", 'export const say = "Not Found, one, two";'),
      source("src/two.ts", "export const fields = (text: string) => text.split(/,\\s*/);", "export const TRACKED = /^Your branch is up to date/;"),
    ])).toEqual([]);
  });

  it("stays quiet on short words and on words that are not a heading, a comment marker or bold", () => {
    expect(writtenTwice([
      source("src/one.ts", 'export const say = "## Wave and **Did not hold** and Session: one";'),
      source("src/two.ts", "export const A = /^## Wa/;", "export const B = /Session:/;", "export const C = /\\*\\*Did not hold\\*\\*/;"),
    ])).toEqual([`written twice: src/two.ts:3 reads "**Did not hold**" that src/one.ts:1 writes; ${ASK}`]);
  });
});
