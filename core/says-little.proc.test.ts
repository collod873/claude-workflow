import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { machinePage } from "./machine-page.ts";
import { parts, type Part } from "./parts.ts";
import { coveredByCheck } from "./check-covers.ts";
import { checkRepo, execute, landSession, scratch, script, type Run } from "./scenarios.ts";

const LIMIT = 200;
const MOST_LINES = 5;
const REPO = resolve(import.meta.dirname, "..");
const NOISE = "a line a tool prints that nobody needed to read\n".repeat(40).trim();
const URL = "https://github.com/collod873/claude-workflow/pull/1";

interface Scenario {
  label: string;
  run: () => Run;
}

const scenarios: Record<string, Scenario[]> = {
  "core/check": [
    { label: "passing", run: () => checkRepo().run() },
    { label: "with a failing test", run: () => checkRepo({ vitest: NOISE }).run() },
    { label: "with every tool failing", run: () => checkRepo({ tsc: NOISE, eslint: NOISE, knip: NOISE, jscpd: NOISE, vitest: NOISE }).run() },
  ],
  "core/bin/land": [
    { label: "waiting on checks while gh chatters", run: () => landSession({ gh: `cat >&2 <<'NOISE'\n${NOISE}\nNOISE\n[[ $2 == create ]] && echo ${URL}\nexit 0\n` }).run() },
    { label: "with gh pr create failing", run: () => landSession({ gh: `[[ $2 == create ]] || exit 0\ncat >&2 <<'NOISE'\n${NOISE}\nNOISE\nexit 1\n` }).run() },
    { label: "with the push refused", run: () => landSession({ gh: "exit 0\n", remoteRefuses: NOISE }).run() },
    { label: "refusing an em dash in a commit message", run: () => landSession({ gh: "exit 0\n", messages: ["change \u2014 dashed"] }).run() },
  ],
};

function speakers(registry: Part[], check: string): string[] {
  const covered = coveredByCheck(check);
  return [...new Set(registry.map((part) => part.file))].filter((file) => !covered(file));
}

function linesAllowed(registry: Part[], file: string): number {
  return Math.max(1, ...registry.filter((part) => part.file === file).map((part) => part.lines ?? 1));
}

function overAllowed(registry: Part[]): string[] {
  return registry.flatMap((part) => {
    if (part.lines === undefined) return [];
    if (part.file.startsWith("core/hooks/")) return [`${part.name} is a hook, so it says one line`];
    return part.lines > MOST_LINES ? [`${part.name} is registered for ${part.lines} lines, over ${MOST_LINES}`] : [];
  });
}

function overheard(part: string, runs: Scenario[] = [], lines = 1): string[] {
  const heard = runs.map(({ label, run }) => {
    const { status, stdout, stderr } = run();
    return { label, status, said: stdout + stderr };
  });
  const passing = heard.some(({ status }) => status === 0) ? [] : [`${part} has no passing run`];
  const failing = heard.some(({ status }) => status !== 0) ? [] : [`${part} has no failing run`];
  const loud = heard.flatMap(({ label, said }) => {
    const spoken = said.replace(/\n$/, "").split("\n");
    const long = spoken.filter((line) => line.length > LIMIT).map((line) => `${part} ${label} said a line of ${line.length} characters, over ${LIMIT}`);
    return spoken.length > lines ? [...long, `${part} ${label} said ${spoken.length} lines, over ${lines}`] : long;
  });
  return [...passing, ...failing, ...loud];
}

describe(`everything core/ prints is one line of ${LIMIT} characters, or up to ${MOST_LINES} for a part registered for them (#683)`, () => {
  it.each(speakers(parts, readFileSync(join(REPO, "core", "check"), "utf8")))("%s stays under the limit on a passing and a failing run", (part) => {
    expect(overheard(part, scenarios[part], linesAllowed(parts, part))).toEqual([]);
  });

  it(`registers no part for more than ${MOST_LINES} lines, and no hook for more than one`, () => {
    expect(overAllowed(parts)).toEqual([]);

    const planted = (file: string, lines: number): Part => ({ name: file, file, stops: URL, lines });
    const registry = [planted("core/bin/lister", MOST_LINES), planted("core/bin/talker", MOST_LINES + 1), planted("core/hooks/flooder.mjs", 2)];
    expect(overAllowed(registry)).toEqual([
      `core/bin/talker is registered for ${MOST_LINES + 1} lines, over ${MOST_LINES}`,
      "core/hooks/flooder.mjs is a hook, so it says one line",
    ]);
    expect(linesAllowed(registry, "core/bin/lister")).toBe(MOST_LINES);
    expect(linesAllowed(registry, "core/check")).toBe(1);
    expect(machinePage(registry, [])).toMatch(new RegExp(`core/bin/lister +claude-workflow/pull/1  \\(${MOST_LINES} lines\\)`));
  });

  it("makes every registered part core/check does not already run prove its own runs, whatever it is written in", () => {
    const planted = (file: string): Part => ({ name: file, file, stops: URL });
    const registry = ["core/hooks/planted.mjs", "core/planted.proc.test.ts", "core/planted.config.ts", "core/check"].map(planted);
    const check = "run lint eslint --config core/planted.config.ts core\n";

    expect(speakers(registry, check)).toEqual(["core/hooks/planted.mjs", "core/check"]);
  });

  it("names a planted part whose line is too long, says too many lines, or has no passing or failing run", () => {
    const dir = scratch("says-little-");
    const said = (text: string, status: number) => {
      const file = join(dir, `said-${text.length}-${status}`);
      script(file, `printf %s '${text}'\nexit ${status}\n`);
      return () => execute(file, dir);
    };

    expect(overheard("planted", [
      { label: "passing", run: said("x".repeat(LIMIT), 0) },
      { label: "failing", run: said("x".repeat(LIMIT + 1), 1) },
    ])).toEqual([`planted failing said a line of ${LIMIT + 1} characters, over ${LIMIT}`]);
    const twoLines = { label: "passing", run: said("x\ny", 0) };
    const failing = { label: "failing", run: said("x", 1) };
    expect(overheard("planted", [twoLines, failing])).toEqual(["planted passing said 2 lines, over 1"]);
    expect(overheard("planted", [twoLines, failing], 2)).toEqual([]);
    expect(overheard("planted", [failing])).toEqual(["planted has no passing run"]);
    expect(overheard("unrun")).toEqual(["unrun has no passing run", "unrun has no failing run"]);
  });
});
