import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parts, type Part } from "./parts.ts";
import { coveredByCheck } from "./check-covers.ts";
import { checkRepo, execute, landSession, scratch, script, type Run } from "./scenarios.ts";

const LIMIT = 200;
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
  ],
};

function speakers(registry: Part[], check: string): string[] {
  const covered = coveredByCheck(check);
  return [...new Set(registry.map((part) => part.file))].filter((file) => !covered(file));
}

function overheard(part: string, runs: Scenario[] = []): string[] {
  const heard = runs.map(({ label, run }) => {
    const { status, stdout, stderr } = run();
    return { label, status, said: stdout + stderr };
  });
  const passing = heard.some(({ status }) => status === 0) ? [] : [`${part} has no passing run`];
  const failing = heard.some(({ status }) => status !== 0) ? [] : [`${part} has no failing run`];
  const loud = heard
    .filter(({ said }) => said.length > LIMIT)
    .map(({ label, said }) => `${part} ${label} said ${said.length} characters, over ${LIMIT}`);
  return [...passing, ...failing, ...loud];
}

describe(`everything core/ prints fits in ${LIMIT} characters (#683)`, () => {
  it.each(speakers(parts, readFileSync(join(REPO, "core", "check"), "utf8")))("%s stays under the limit on a passing and a failing run", (part) => {
    expect(overheard(part, scenarios[part])).toEqual([]);
  });

  it("makes every registered part core/check does not already run prove its own runs, whatever it is written in", () => {
    const planted = (file: string): Part => ({ name: file, file, stops: URL });
    const registry = ["core/hooks/planted.mjs", "core/planted.proc.test.ts", "core/planted.config.ts", "core/check"].map(planted);
    const check = "run lint eslint --config core/planted.config.ts core\n";

    expect(speakers(registry, check)).toEqual(["core/hooks/planted.mjs", "core/check"]);
  });

  it("names a planted part that says too much, or has no passing or failing run", () => {
    const dir = scratch("says-little-");
    const said = (text: string, status: number) => {
      const file = join(dir, `said-${text.length}-${status}`);
      script(file, `printf %s '${text}'\nexit ${status}\n`);
      return () => execute(file, dir);
    };

    expect(overheard("planted", [
      { label: "passing", run: said("x".repeat(LIMIT), 0) },
      { label: "failing", run: said("x".repeat(LIMIT + 1), 1) },
    ])).toEqual([`planted failing said ${LIMIT + 1} characters, over ${LIMIT}`]);
    expect(overheard("planted", [{ label: "failing", run: said("x", 1) }])).toEqual(["planted has no passing run"]);
    expect(overheard("unrun")).toEqual(["unrun has no passing run", "unrun has no failing run"]);
  });
});
