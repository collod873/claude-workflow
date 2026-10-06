import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { machineSource, scriptSource, spelledByHand, writtenTwice } from "./written-twice.ts";

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

  it("passes the machine's own source, and refuses it once a line spells an existing marker a second time", () => {
    const machine = machineSource(import.meta.dirname);

    expect(writtenTwice(machine)).toEqual([]);
    expect(writtenTwice([...machine, source("src/planted.ts", "export const MOVED = /<!-- moves: ([\\d, ]*) -->/;")])).toEqual([
      expect.stringMatching(/^written twice: src\/planted\.ts:1 reads "<!-- moves: " that src\/wave\.ts:\d+ writes; /),
    ]);
  });
});

describe("written twice refuses a script, workflow or action that spells by hand what spelled or a TypeScript constant holds (#1123)", () => {
  const machine = machineSource(import.meta.dirname);
  const asked = (key: string) => `ask bin/spelled ${key} for it`;
  const refused = (...scripts: { file: string; text: string }[]) => spelledByHand(scripts, machine);

  it("refuses a label planted in a workflow file as a quoted string, a shell word or the argument of --label", () => {
    expect(refused(source(".github/workflows/planted.yml", "jobs:", "  one:", "    if: contains(github.event.issue.labels.*.name, 'waiting')", "    steps:", "      - run: |", "          bin/mark 1 stuck", "          gh issue edit 1 --add-label x --label queued", "          grep -qx note <<<\"$labels\""))).toEqual([
      `written twice: .github/workflows/planted.yml:3 spells "waiting" that src/spelled.ts holds; ${asked("WAITING")}`,
      `written twice: .github/workflows/planted.yml:6 spells "stuck" that src/spelled.ts holds; ${asked("STUCK")}`,
      `written twice: .github/workflows/planted.yml:7 spells "queued" that src/spelled.ts holds; ${asked("QUEUED")}`,
      `written twice: .github/workflows/planted.yml:8 spells "note" that src/spelled.ts holds; ${asked("NOTE")}`,
    ]);
  });

  it("refuses the ticket branch prefix planted in a script, wherever it stands outside a comment", () => {
    expect(refused(source("bin/planted", "#!/bin/bash", "# a ticket/ in a comment says nothing", 'git push origin "HEAD:ticket/$n"'))).toEqual([
      `written twice: bin/planted:3 spells "ticket/" that src/spelled.ts holds; ${asked("TICKET_PREFIX")}`,
    ]);
  });

  it("refuses the bot's login planted in an action's committer line, and allows it in a job's if: sender test", () => {
    const action = source(".github/actions/planted/action.yml", "runs:", "  using: composite", "  steps:", "    - shell: bash", "      run: |", '        git config user.name "collod873-machine[bot]"');
    const workflow = source(".github/workflows/planted.yml", "jobs:", "  one:", "    if: \"${{ github.event.sender.login == 'collod873-machine[bot]' }}\"");

    expect(refused(action, workflow)).toEqual([
      `written twice: .github/actions/planted/action.yml:6 spells "collod873-machine[bot]" that src/spelled.ts holds; ${asked("MACHINE")}`,
      `written twice: .github/actions/planted/action.yml:6 spells "collod873" that src/spelled.ts holds; ${asked("OWNER")}`,
    ]);
  });

  it("refuses a heading or marker the TypeScript holds as a constant, naming the constant", () => {
    expect(refused(source("bin/planted", "#!/bin/bash", "grep -q '<!-- fix-wave -->' <<<\"$said\""))).toEqual([
      expect.stringMatching(/^written twice: bin\/planted:2 spells "<!-- fix-wave -->" that src\/done-checker\.ts:\d+ declares; /),
    ]);
  });

  it("stays quiet on a label inside a sentence, a YAML name or id, the posting kinds in bin/file-issue and bin/spelled itself", () => {
    expect(
      refused(
        source("bin/planted", "#!/bin/bash", "printf 'close-note: #%s is not a note; a ticket closes when its PR merges\\n' \"$n\""),
        source(".github/workflows/planted.yml", "jobs:", "  research:", "    steps:", "      - id: asked", "        with:", "          run: the research run"),
        source("bin/file-issue", "#!/bin/bash", "[[ $kind != ticket && $kind != note && $kind != research && $kind != spec ]]"),
        source("bin/spelled", "#!/bin/bash", "printf 'stuck'"),
      ),
    ).toEqual([]);
  });

  it("passes every bin/ script, workflow and action as merged", () => {
    expect(spelledByHand(scriptSource(join(import.meta.dirname, "..")), machine)).toEqual([]);
  });
});
