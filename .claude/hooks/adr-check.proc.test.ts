import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const checker = join(root, "bin", "adr-check");

type Outcome = { code: number | null; out: string; err: string };

function check(args: string[], cwd: string): Outcome {
  const env = { ...process.env };
  delete env.TARGET_WORKSPACE;
  const done = spawnSync("python3", [checker, ...args], { cwd, encoding: "utf8", env });
  return { code: done.status, out: done.stdout ?? "", err: done.stderr ?? "" };
}

function ruling(title: string, date: string): string {
  return `---\nstatus: constraint\ndate: ${date}\nreversal: the number is named in four repos' issue bodies and keyed into two lint rules\n---\n\n# ${title}\n\nTwo authors write the corpus from separate trees, so a number picked by scanning one directory is picked against a corpus the other is already past.\n`;
}

function corpora(prefix: string, records: Array<[string, number, string, string]>): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  for (const [where, number, title, date] of records) {
    const dir = join(repo, where, "docs", "adr");
    mkdirSync(dir, { recursive: true });
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    writeFileSync(join(dir, `${String(number).padStart(4, "0")}-${slug}.md`), ruling(title, date));
  }
  return repo;
}

test(
  "#412.1: adr-check reads every docs/adr/ under the root, outside node_modules, as one corpus with one number sequence",
  () => {
    const repo = corpora("adr-one-corpus-412-", [
      ["", 1, "Triage labels are positions not verdicts", "2026-01-01"],
      ["src/features/accounting", 2, "Ledger entries are appended never edited", "2026-01-02"],
      ["node_modules/vendored", 1, "A vendored ruling nothing here is bound by", "2026-01-03"],
    ]);
    writeFileSync(join(repo, "notes.md"), "the ledger follows ADR-0002\n");
    check(["--fix"], repo);

    const clean = check([], repo);
    expect(clean.err).not.toContain("ADR-0002");
    expect(clean.code).toBe(0);
    expect(clean.out).toContain("2 ADRs");

    const clash = corpora("adr-clash-412-", [
      ["", 1, "A root ruling that binds later work", "2026-01-01"],
      ["src/features/crm", 1, "A second ruling filed under the same number", "2026-01-02"],
    ]);
    check(["--fix"], clash);

    const collided = check([], clash);
    expect(collided.code).toBe(1);
    expect(collided.err).toMatch(/finding:.*0001/);
  },
  60_000,
);

test(
  "#412.4: adr-check --bar-from YYYY-MM-DD exempts records dated before that day from the body cap and the frontmatter checks, and from nothing else",
  () => {
    const repo = corpora("adr-bar-412-", [
      ["", 3, "A ruling filed after the bar was adopted", "2026-06-01"],
    ]);
    writeFileSync(
      join(repo, "docs", "adr", "0001-an-old-ruling-written-before-the-bar.md"),
      `---\nstatus: constraint\ndate: 2020-01-01\n---\n\n# An old ruling written before the bar\n\n${"word ".repeat(200).trim()}\n`,
    );
    check(["--fix", "--bar-from", "2026-01-01"], repo);

    const exempt = check(["--bar-from", "2026-01-01"], repo);
    expect(exempt.err).not.toMatch(/finding:/);
    expect(exempt.code).toBe(0);

    const strict = check([], repo);
    expect(strict.code).toBe(1);
    expect(strict.err).toMatch(/finding:.*0001/);

    writeFileSync(join(repo, "notes.md"), "this cites ADR-0002\n");
    const gap = check(["--bar-from", "2026-01-01"], repo);
    expect(gap.code).toBe(1);
    expect(gap.err).toMatch(/finding:.*ADR-0002/);
  },
  60_000,
);

test(
  "#412.5: this repository's own corpus is unchanged by the above and adr-check stays clean at its root",
  () => {
    const plain = check([], root);
    const barred = check(["--bar-from", "1970-01-01"], root);
    const tally = (out: string) => out.split("\n").find((line) => line.includes(" ADRs")) ?? "";

    expect([plain.code, barred.code]).toEqual([0, 0]);
    expect(plain.err).not.toMatch(/finding:/);
    expect(barred.err).not.toMatch(/finding:/);
    expect(tally(barred.out)).toBe(tally(plain.out));
  },
  120_000,
);
