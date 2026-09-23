import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { machinePage } from "./machine-page.ts";
import { parts, type Part } from "./parts.ts";
import { LINE_LIMIT, MOST_LINES, authoring, briefing, building, checkRepo, checking, coveredByCheck, execute, filing, landSession, minting, misshapenTicket, overLimit, saving, scratch, script, starting, wellFormedNote, wellFormedTicket, type Run } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const NOISE = "a line a tool prints that nobody needed to read\n".repeat(40).trim();
const URL = "https://github.com/collod873/claude-workflow/pull/1";
const FILED = `printf '%s\\n' ${URL}\n`;
const GREEN = "printf '      Tests  1 passed (1)\\n'\nexit 0\n";
const NOTE_CALL = ["note", "--title", "What the audit found", "--body-file", "body.md"];

interface Scenario {
  label: string;
  run: () => Run;
}

const scenarios: Record<string, Scenario[]> = {
  "bin/check": [
    { label: "passing", run: () => checkRepo().run() },
    { label: "with a failing test", run: () => checkRepo({ vitest: NOISE }).run() },
    { label: "with every tool failing", run: () => checkRepo({ tsc: NOISE, eslint: NOISE, knip: NOISE, jscpd: NOISE, vitest: NOISE, node: NOISE }).run() },
  ],
  "bin/land": [
    { label: "waiting on checks while gh chatters", run: () => landSession({ gh: `cat >&2 <<'NOISE'\n${NOISE}\nNOISE\n[[ $2 == create ]] && echo ${URL}\nexit 0\n` }).run() },
    { label: "with gh pr create failing", run: () => landSession({ gh: `[[ $2 == create ]] || exit 0\ncat >&2 <<'NOISE'\n${NOISE}\nNOISE\nexit 1\n` }).run() },
    { label: "with the push refused", run: () => landSession({ gh: "exit 0\n", remoteRefuses: NOISE }).run() },
    { label: "refusing an em dash in a commit message", run: () => landSession({ gh: "exit 0\n", messages: ["change \u2014 dashed"] }).run() },
  ],
  "src/check-runner.ts": [
    { label: "on a ticket whose check is red", run: () => checking("exit 1\n").run() },
    { label: "on a ticket whose check already passes", run: () => checking(GREEN).run() },
  ],
  "bin/app-token": [
    { label: "minting the App's token", run: () => minting().run() },
    { label: "with no key set", run: () => minting({ key: "" }).run() },
  ],
  "bin/machine-page": [
    { label: "rendering the page", run: () => execute(join(REPO, "bin", "machine-page"), REPO) },
    { label: "outside a repo to read", run: () => execute(join(REPO, "bin", "machine-page"), scratch("machine-page-")) },
  ],
  "bin/file-issue": [
    { label: "filing a ticket", run: () => filing({ gh: FILED, body: wellFormedTicket }).run() },
    { label: "refusing a body with one defect", run: () => filing({ gh: FILED, body: wellFormedTicket.replace("## Why", "## Background") }).run() },
    { label: "refusing a body defective more ways than it shows", run: () => filing({ gh: FILED, body: misshapenTicket }).run() },
    { label: "refusing a call it does not file", run: () => filing({ gh: FILED, body: wellFormedTicket }).run(["judgement", "--title", "A judgement"]) },
    { label: "refusing a ticket whose check already passes", run: () => filing({ gh: FILED, body: wellFormedTicket, npx: GREEN }).run() },
    { label: "filing a note", run: () => filing({ gh: FILED, body: wellFormedNote }).run(NOTE_CALL) },
    { label: "refusing a note that says no why", run: () => filing({ gh: FILED, body: "Four proposals, with no heading over them.\n" }).run(NOTE_CALL) },
  ],
  "bin/brief": [
    { label: "writing a brief", run: () => briefing().run() },
    { label: "refusing a claim over the cap", run: () => briefing({ claimed: { "src/ticket-shape.ts": "export const filler = 1;\n".repeat(3000) } }).run() },
  ],
  "bin/build": [
    { label: "building to the checks", run: () => building({ npx: GREEN }).run() },
    { label: "ending red after the repair round", run: () => building().run() },
    { label: "refusing a claim over the cap", run: () => building({ claimed: { "src/ticket-shape.ts": "export const filler = 1;\n".repeat(3000) } }).run() },
  ],
  "bin/save": [
    { label: "saving a build", run: () => saving().run() },
    { label: "with the push refused", run: () => saving({ remoteRefuses: NOISE }).run() },
  ],
  "bin/test-author": [
    { label: "writing a failing test for each criterion", run: () => authoring().run() },
    { label: "refusing a criterion whose check already passes", run: () => authoring({ npx: GREEN }).run() },
  ],
  "bin/start": [
    { label: "starting a build", run: () => starting().run() },
    { label: "refusing a body defective more ways than it shows", run: () => starting({ body: misshapenTicket }).run() },
    { label: "refusing a ticket whose checks already pass", run: () => starting({ npx: GREEN }).run() },
  ],
};

function speakers(registry: Part[], check: string): string[] {
  const covered = coveredByCheck(check);
  return [...new Set(registry.map((part) => part.file))].filter((file) => !covered(file));
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

function overheard(part: string, runs: Scenario[] = [], lines = 1): string[] {
  const heard = runs.map(({ label, run }) => {
    const { status, stdout, stderr } = run();
    return { label, status, said: stdout + stderr };
  });
  const passing = heard.some(({ status }) => status === 0) ? [] : [`${part} has no passing run`];
  const failing = heard.some(({ status }) => status !== 0) ? [] : [`${part} has no failing run`];
  const loud = heard.flatMap(({ label, said }) => overLimit(said, lines).map((problem) => `${part} ${label} ${problem}`));
  return [...passing, ...failing, ...loud];
}

describe(`everything the machine prints is one line of ${LINE_LIMIT} characters, or up to ${MOST_LINES} for a part registered for them (#683)`, () => {
  it.each(speakers(parts, readFileSync(join(REPO, "bin", "check"), "utf8")))("%s stays under the limit on a passing and a failing run", (part) => {
    expect(overheard(part, scenarios[part], linesAllowed(parts, part))).toEqual([]);
  });

  it(`registers no part for more than ${MOST_LINES} lines`, () => {
    expect(overAllowed(parts)).toEqual([]);

    const planted = (file: string, lines: number): Part => ({ name: file, file, stops: URL, lines });
    const registry = [planted("bin/lister", MOST_LINES), planted("bin/talker", MOST_LINES + 1)];
    expect(overAllowed(registry)).toEqual([`bin/talker is registered for ${MOST_LINES + 1} lines, over ${MOST_LINES}`]);
    expect(linesAllowed(registry, "bin/lister")).toBe(MOST_LINES);
    expect(linesAllowed(registry, "bin/check")).toBe(1);
    expect(machinePage(registry, [])).toMatch(new RegExp(`bin/lister +PR 1 \\(${MOST_LINES} lines\\)`));
  });

  it("makes every registered part bin/check does not already run prove its own runs, whatever it is written in", () => {
    const planted = (file: string): Part => ({ name: file, file, stops: URL });
    const registry = ["bin/planted", "src/planted.proc.test.ts", "src/planted.config.ts", "bin/check"].map(planted);
    const check = "run lint eslint --config src/planted.config.ts src\n";

    expect(speakers(registry, check)).toEqual(["bin/planted", "bin/check"]);
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
