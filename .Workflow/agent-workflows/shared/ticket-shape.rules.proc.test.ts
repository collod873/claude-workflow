import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const rulesPath = fileURLToPath(new URL("./ticket-shape.rules.json", import.meta.url));

type Rules = {
  fragments: Record<string, string>;
  grammar: Record<string, { source: string; flags: string }>;
};

function readRules(): Rules {
  return JSON.parse(readFileSync(rulesPath, "utf8")) as Rules;
}

function expand(source: string, fragments: Record<string, string>): string {
  return source.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in fragments ? fragments[name] : whole,
  );
}

function compile(rules: Rules, name: string): RegExp {
  const rule = rules.grammar[name];
  return new RegExp(expand(rule.source, rules.fragments), rule.flags);
}

const HEADING_PROBES: Array<{ text: string; matches: boolean }> = [
  { text: "## Acceptance criteria", matches: true },
  { text: "##\tAcceptance criteria\t\r", matches: true },
  { text: "Notes\n## Acceptance criteria\nmore", matches: true },
  { text: "## Acceptance Criteria", matches: false },
  { text: "  ## Acceptance criteria", matches: false },
  { text: "### Acceptance criteria", matches: false },
];

const PYTHON_PROBE = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[2])",
  "import ticket_shape",
  "probes = json.loads(sys.argv[1])",
  "print(json.dumps([bool(ticket_shape.CRITERIA_HEADING_RE.search(p)) for p in probes]))",
].join("\n");

function pythonVerdicts(probes: string[]): boolean[] {
  const out = execFileSync(
    "python3",
    ["-c", PYTHON_PROBE, JSON.stringify(probes), join(repoRoot, "bin")],
    { cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  return JSON.parse(out) as boolean[];
}

function namesNeedle(file: string, needle: string): boolean {
  try {
    execFileSync("grep", ["-q", "-F", "-e", needle, file], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

test.fails("#552.4: both validators still compile their shared grammar from that one file", () => {
  const rules = readRules();
  expect(JSON.stringify(rules)).toMatch(/ADR-\d{4}/);

  const heading = compile(rules, "criteriaHeading");
  const fromRulesFile = HEADING_PROBES.map((probe) => heading.test(probe.text));
  expect(fromRulesFile).toEqual(HEADING_PROBES.map((probe) => probe.matches));

  expect(pythonVerdicts(HEADING_PROBES.map((probe) => probe.text))).toEqual(fromRulesFile);
});

test.fails("#552.5: the whole check contract holds - the recorded ADR number resolves to that landed ADR and the grammar still expands", () => {
  const rules = readRules();
  const referenced = [...JSON.stringify(rules).matchAll(/ADR-(\d{4})/g)].map((match) => match[1]);
  expect(referenced.length).toBeGreaterThan(0);

  const adrDir = join(repoRoot, "docs", "adr");
  const landed = existsSync(adrDir)
    ? readdirSync(adrDir).filter((name) => name.endsWith(".md"))
    : [];
  for (const number of referenced) {
    expect(landed.some((name) => name.startsWith(`${number}-`) || name === `${number}.md`)).toBe(
      true,
    );
  }

  const ruling = referenced
    .flatMap((number) => landed.filter((name) => name.startsWith(`${number}-`)))
    .map((name) => join("docs", "adr", name))
    .filter((file) =>
      ["PATH_LINE_RE", "canary-graph", "gh_support"].every((needle) =>
        namesNeedle(file, needle),
      ),
    );
  expect(ruling.length).toBeGreaterThanOrEqual(1);

  const placeholder = new RegExp(`\\{(${Object.keys(rules.fragments).join("|")})\\}`);
  for (const name of Object.keys(rules.grammar)) {
    expect(() => compile(rules, name)).not.toThrow();
    expect(expand(rules.grammar[name].source, rules.fragments)).not.toMatch(placeholder);
  }
});
