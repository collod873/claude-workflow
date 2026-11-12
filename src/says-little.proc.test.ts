import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parts, type Part } from "./parts.ts";
import { CONTRACT, LINE_LIMIT, MOST_LINES, coveredByCheck, execute, overLimit, scratch, script } from "./scenarios.ts";
import { partFiles, type Scenario } from "./part-files.ts";

const REPO = resolve(import.meta.dirname, "..");
const URL = "https://github.com/collod873/claude-workflow/pull/1";

const scenarios: Record<string, Scenario[]> = Object.fromEntries((await partFiles()).map((partFile) => [partFile.part.file, partFile.scenarios]));

function speakers(registry: Part[], contract: string): string[] {
  const covered = coveredByCheck(contract);
  return [...new Set(registry.map((part) => part.file))].filter((file) => !covered(file) && !file.startsWith(".github/workflows/"));
}

function linesAllowed(registry: Part[], file: string): number {
  return Math.max(1, ...registry.filter((part) => part.file === file).map((part) => Math.min(part.lines ?? 1, MOST_LINES)));
}

function overAllowed(registry: Part[]): string[] {
  return registry.flatMap((part) => {
    if (part.lines === undefined) return [];
    return part.lines > MOST_LINES ? [`${part.name} is registered for ${part.lines} lines, over ${MOST_LINES}`] : [];
  });
}

function printsData(registry: Part[], file: string): boolean {
  return registry.some((part) => part.file === file && part.printsData === true);
}

function overheard(part: string, runs: Scenario[] = [], lines = 1, data = false): string[] {
  const heard = runs.map(({ label, run }) => {
    const { status, stdout, stderr } = run();
    return { label, status, said: data && status === 0 ? stderr : stdout + stderr };
  });
  const passing = heard.some(({ status }) => status === 0) ? [] : [`${part} has no passing run`];
  const failing = heard.some(({ status }) => status !== 0) ? [] : [`${part} has no failing run`];
  const loud = heard.flatMap(({ label, said }) => overLimit(said, lines).map((problem) => `${part} ${label} ${problem}`));
  return [...passing, ...failing, ...loud];
}

describe(`everything the machine prints is one line of ${LINE_LIMIT} characters, or up to ${MOST_LINES} for a part registered for them (#683)`, () => {
  it.each(speakers(parts, readFileSync(join(REPO, CONTRACT), "utf8")))("%s stays under the limit on a passing and a failing run", (part) => {
    expect(overheard(part, scenarios[part], linesAllowed(parts, part), printsData(parts, part))).toEqual([]);
  });

  it(`registers no part for more than ${MOST_LINES} lines`, () => {
    expect(overAllowed(parts)).toEqual([]);

    const planted = (file: string, lines: number): Part => ({ name: file, file, stops: URL, lines });
    const registry = [planted("bin/lister", MOST_LINES), planted("bin/talker", MOST_LINES + 1)];
    expect(overAllowed(registry)).toEqual([`bin/talker is registered for ${MOST_LINES + 1} lines, over ${MOST_LINES}`]);
    expect(linesAllowed(registry, "bin/lister")).toBe(MOST_LINES);
    expect(linesAllowed(registry, "bin/unlisted")).toBe(1);
  });

  it("leaves uncounted only the rows a data part prints on a passing run, never what it says on stderr or when it fails (#1100)", () => {
    const rows = (status: number, stderr = ""): Scenario => ({ label: `ending ${status}`, run: () => ({ status, stdout: "row\n".repeat(MOST_LINES + 1), stderr }) });

    expect(printsData([{ name: "bin/lister", file: "bin/lister", stops: URL, printsData: true }], "bin/lister")).toBe(true);
    expect(printsData(parts, "bin/land")).toBe(false);
    expect(overheard("bin/lister", [rows(0), rows(2)], 1, true)).toEqual([`bin/lister ending 2 said ${MOST_LINES + 1} lines, over 1`]);
    expect(overheard("bin/lister", [rows(0, "one\ntwo\n")], 1, true)).toEqual(["bin/lister has no failing run", "bin/lister ending 0 said 2 lines, over 1"]);
  });

  it("makes every registered part the contract's steps do not already run prove its own runs, whatever it is written in", () => {
    const planted = (file: string): Part => ({ name: file, file, stops: URL });
    const registry = ["bin/planted", "src/planted.proc.test.ts", "src/planted.config.ts", CONTRACT, "src/planted-each.config.ts", "src/unrun.ts"].map(planted);
    const contract = JSON.stringify({ steps: { lint: { run: "node_modules/.bin/eslint --config src/planted.config.ts src", each: "node_modules/.bin/eslint --config src/planted-each.config.ts <files>" } } });

    expect(speakers(registry, contract)).toEqual(["bin/planted", "src/unrun.ts"]);
  });

  it("names a planted part whose line is too long, says too many lines, or has no passing or failing run", () => {
    const dir = scratch("says-little-");
    const said = (text: string, status: number) => {
      const file = join(dir, `said-${text.length}-${status}`);
      script(file, `printf %s '${text}'\nexit ${status}\n`);
      return () => execute(file, dir);
    };

    expect(overheard("planted", [
      { label: "passing", run: said("x".repeat(LINE_LIMIT), 0) },
      { label: "failing", run: said("x".repeat(LINE_LIMIT + 1), 1) },
    ])).toEqual([`planted failing said a line of ${LINE_LIMIT + 1} characters, over ${LINE_LIMIT}`]);
    const twoLines = { label: "passing", run: said("x\ny", 0) };
    const failing = { label: "failing", run: said("x", 1) };
    expect(overheard("planted", [twoLines, failing])).toEqual(["planted passing said 2 lines, over 1"]);
    expect(overheard("planted", [twoLines, failing], 2)).toEqual([]);
    expect(overheard("planted", [failing])).toEqual(["planted has no passing run"]);
    expect(overheard("unrun")).toEqual(["unrun has no passing run", "unrun has no failing run"]);
  });
});
