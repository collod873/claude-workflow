import { expect, test } from "vitest";
import { basename, dirname, join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const filer = fileURLToPath(new URL("../../bin/new-adr", import.meta.url));

function cleanEnv() {
  const copy = { ...process.env };
  delete copy.TARGET_WORKSPACE;
  delete copy.EDITOR;
  return copy;
}

function record(title: string): string {
  return [
    "---",
    "status: constraint",
    "date: 2026-09-10",
    "reversal: every issue body in four repos names the marker, and two lint rules are keyed to it",
    "---",
    "",
    `# ${title}`,
    "",
    "One sequence spans the corpora, so a number scanned out of one directory is a number",
    "the other tree is already past.",
    "",
    "**Rejected: a sequence per corpus.** Two sequences collide the first time a ruling in",
    "one is cited from the other.",
    "",
  ].join("\n");
}

function put(dir: string, name: string, text: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

function file(args: string[], cwd: string): { code: number | null; out: string } {
  const done = spawnSync("python3", [filer, ...args], { cwd, encoding: "utf8", env: cleanEnv() });
  return { code: done.status, out: (done.stdout ?? "").trim() };
}

test.fails(
  "#412.2: new-adr claims the next number across every corpus and lands the record in the corpus the caller names, defaulting to the root",
  () => {
    const repo = mkdtempSync(join(tmpdir(), "new-adr-412-"));
    spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
    const rootCorpus = join(repo, "docs", "adr");
    const featureCorpus = join(repo, "src", "features", "accounting", "docs", "adr");
    put(rootCorpus, "0001-a-root-ruling-that-binds-later-work.md",
      record("A root ruling that binds later work"));
    put(featureCorpus, "0007-a-feature-ruling-that-binds-later-work.md",
      record("A feature ruling that binds later work"));

    const drafted = file(["Ledger entries are appended, never edited"], repo);
    expect(drafted.code).toBe(0);
    expect(dirname(drafted.out)).toBe(rootCorpus);
    expect(basename(drafted.out)).toMatch(/^draft-/);
    writeFileSync(drafted.out, record("Ledger entries are appended, never edited"));

    const eighth = join(rootCorpus, basename(drafted.out).replace(/^draft-/, "0008-"));
    const landed = file(["--land", drafted.out], repo);
    expect(landed.code).toBe(0);
    expect(landed.out).toBe(eighth);
    expect(existsSync(eighth)).toBe(true);

    const ninth = "0009-purchase-orders-close-on-receipt-of-goods.md";
    const featureDraft = put(featureCorpus, "draft-purchase-orders-close-on-receipt-of-goods.md",
      record("Purchase orders close on receipt of goods"));
    const filed = file(["--land", featureDraft], repo);
    expect([filed.code, filed.out]).toEqual([0, join(featureCorpus, ninth)]);
    expect(existsSync(join(featureCorpus, ninth))).toBe(true);
    expect(existsSync(join(rootCorpus, ninth))).toBe(false);
    expect(existsSync(featureDraft)).toBe(false);
  },
  60_000,
);
