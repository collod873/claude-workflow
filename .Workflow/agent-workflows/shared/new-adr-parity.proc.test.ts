import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { newAdrRepo } from "./new-adr.fixture.ts";
import { makeTempRepo, type TempRepo } from "./temp-repo.fixture.ts";

const SKILLS_NEW_ADR = join(process.env.HOME ?? "", "bin/new-adr");
const RULING = "A ruling that binds later work";

const GOOD = `---
status: constraint
date: 2026-09-04
reversal: Undoing this means rewriting every lane that reads the index.
---

# ${RULING}

**Rejected: a second corpus.** It would have cost two writers one grammar.
`;

const REVERSAL_LINE = "reversal: Undoing this means rewriting every lane that reads the index.";
const TITLE_LINE = `# ${RULING}`;
const REJECTED_LINE = "**Rejected: a second corpus.** It would have cost two writers one grammar.";

const CASES: [name: string, draft: string][] = [
  ["no-frontmatter", GOOD.slice(GOOD.indexOf(TITLE_LINE))],
  ["missing-reversal", GOOD.replace(`${REVERSAL_LINE}\n`, "")],
  ["bad-status", GOOD.replace("status: constraint", "status: accepted")],
  ["no-title", GOOD.replace(`${TITLE_LINE}\n\n`, "")],
  ["short-title", GOOD.replace(TITLE_LINE, "# Triage labels")],
  ["over-cap", `${GOOD}\n${"word ".repeat(200)}\n`],
  ["empty-reversal", GOOD.replace(REVERSAL_LINE, "reversal:")],
  ["no-rejected", GOOD.replace(REJECTED_LINE, "It binds because two writers share one grammar.")],
  ["a-ruling-that-binds-later-work", GOOD],
];

interface Run {
  code: number;
  out: string;
  errors: string[];
}

function run(bin: string, root: string, args: string[]): Run {
  const env = { ...process.env };
  delete env.EDITOR;
  delete env.VISUAL;

  const done = spawnSync(bin, args, { cwd: root, encoding: "utf8", env });
  return {
    code: done.status ?? -1,
    out: (done.stdout ?? "").trim(),
    errors: (done.stderr ?? "").split("\n").filter((line) => line.startsWith("error: ")),
  };
}

function skillsAndWorkflow(prefix: string): [TempRepo, TempRepo] {
  return [makeTempRepo(`${prefix}-skills`), newAdrRepo(`${prefix}-workflow`)];
}

function binIn(repo: TempRepo, index: number): string {
  return index === 0 ? SKILLS_NEW_ADR : join(repo.dir, "bin/new-adr");
}

describe("bin/new-adr and the skills new-adr", () => {
  it.skipIf(!existsSync(SKILLS_NEW_ADR))(
    "stamp the same draft byte for byte, so an agent on a runner writes against the bar an agent here writes against",
    () => {
      const [fromSkills, fromWorkflow] = skillsAndWorkflow("new-adr-parity-draft").map((repo, index) =>
        run(binIn(repo, index), repo.dir, [RULING]),
      );

      expect(fromWorkflow.code).toBe(fromSkills.code);
      expect(basename(fromWorkflow.out)).toBe(basename(fromSkills.out));
      expect(readFileSync(fromWorkflow.out, "utf8")).toBe(readFileSync(fromSkills.out, "utf8"));
    },
  );

  it.skipIf(!existsSync(SKILLS_NEW_ADR))(
    "stamp the same amends: draft byte for byte, so a successor carries its predecessor in one place in both",
    () => {
      const args = ["--amends", "8", RULING];
      const [fromSkills, fromWorkflow] = skillsAndWorkflow("new-adr-parity-amends").map((repo, index) =>
        run(binIn(repo, index), repo.dir, args),
      );

      expect(readFileSync(fromWorkflow.out, "utf8")).toBe(readFileSync(fromSkills.out, "utf8"));
    },
  );

  it.skipIf(!existsSync(SKILLS_NEW_ADR))(
    "both refuse the draft their own template produces, so filing one and landing it unedited is not a way past the bar",
    () => {
      const landings = skillsAndWorkflow("new-adr-parity-unedited").map((repo, index) => {
        const bin = binIn(repo, index);
        return run(bin, repo.dir, ["--land", run(bin, repo.dir, [RULING]).out]);
      });

      expect(landings[1].code).toBe(1);
      expect(landings[1].code).toBe(landings[0].code);
      expect(landings[1].errors).toEqual(landings[0].errors);
    },
  );
});

describe("bin/new-adr --land and the skills new-adr --land", () => {
  it.skipIf(!existsSync(SKILLS_NEW_ADR)).each(CASES)(
    "reach the same verdict in the same words on a %s draft, so a ruling admitted on a runner is one admitted here",
    (name, contents) => {
      const relative = `docs/adr/draft-${name}.md`;
      const landings = skillsAndWorkflow(`new-adr-parity-${name}`).map((repo, index) => {
        repo.write(relative, contents);
        return run(binIn(repo, index), repo.dir, ["--land", relative]);
      });

      expect(landings[1].errors).toEqual(landings[0].errors);
      expect(landings[1].code).toBe(landings[0].code);
      expect(basename(landings[1].out)).toBe(basename(landings[0].out));
    },
  );
});
