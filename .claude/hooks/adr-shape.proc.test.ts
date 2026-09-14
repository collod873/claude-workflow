import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HOOKS, "../..");
const BIN = join(REPO_ROOT, "bin");

const SHAPE_PROBE = `
import importlib.util, json, os, sys

bin_dir = sys.argv[1]
sys.path.insert(0, bin_dir)
spec = importlib.util.spec_from_file_location("adr_shape", os.path.join(bin_dir, "adr_shape.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

print(json.dumps({
    "renderIndex": hasattr(mod, "render_index"),
    "indexHeader": hasattr(mod, "INDEX_HEADER"),
    "retiredHeader": hasattr(mod, "RETIRED_HEADER"),
    "indexName": hasattr(mod, "INDEX_NAME"),
    "validate": hasattr(mod, "validate"),
}))
`;

interface ShapeProbe {
  renderIndex: boolean;
  indexHeader: boolean;
  retiredHeader: boolean;
  indexName: boolean;
  validate: boolean;
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TARGET_WORKSPACE;
  delete env.EDITOR;
  delete env.VISUAL;
  return env;
}

function python(args: string[], cwd: string, timeout = 120000) {
  return spawnSync("python3", args, { cwd, encoding: "utf8", env: cleanEnv(), timeout });
}

function probeShape(): ShapeProbe {
  const probe = python(["-c", SHAPE_PROBE, BIN], REPO_ROOT);
  expect(probe.status).toBe(0);
  return JSON.parse(probe.stdout ?? "") as ShapeProbe;
}

function landedAdr(title: string): string {
  return [
    "---",
    "status: constraint",
    "date: 2026-01-01",
    "reversal: four repos carry the marker in their issue bodies and two lint rules key on it",
    "---",
    "",
    `# ${title}`,
    "",
    "**Rejected: a second numbering scheme.** Two schemes collide at the land.",
    "",
  ].join("\n");
}

const LEDGER_DRAFT = [
  "---",
  "status: constraint",
  "date: 2026-01-01",
  "reversal: two authors write the corpus from separate trees and the numbers are already claimed",
  "---",
  "",
  "# Ledger entries are appended, never edited",
  "",
  "**Rejected: one shared sequence filed only at the root.** It forces every feature corpus through one directory.",
  "",
].join("\n");

test.fails(
  "#553.1: bin/adr_shape.py no longer renders an index: render_index, INDEX_HEADER and RETIRED_HEADER are gone",
  () => {
    const shape = probeShape();

    expect(shape.renderIndex).toBe(false);
    expect(shape.indexHeader).toBe(false);
    expect(shape.retiredHeader).toBe(false);
    expect(shape.validate).toBe(true);
    expect(shape.indexName).toBe(true);
  },
  180000,
);

test.fails(
  "#553.2: no Python writes docs/adr/INDEX.md; bin/adr-check and bin/new-adr leave it to the adrs slot",
  () => {
    const repo = mkdtempSync(join(tmpdir(), "adr-python-index-"));
    spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });

    const corpus = join(repo, "docs", "adr");
    mkdirSync(corpus, { recursive: true });
    writeFileSync(
      join(corpus, "0001-a-first-ruling-that-binds-later-work.md"),
      landedAdr("A first ruling that binds later work"),
    );
    writeFileSync(
      join(corpus, "0002-a-second-ruling-that-binds-later-work.md"),
      landedAdr("A second ruling that binds later work"),
    );

    const checked = python([join(BIN, "adr-check")], repo);

    expect(checked.stderr ?? "").not.toContain("INDEX.md");
    expect(checked.status).toBe(0);
    expect(existsSync(join(corpus, "INDEX.md"))).toBe(false);

    const fixed = python([join(BIN, "adr-check"), "--fix"], repo);

    expect(fixed.status).toBe(0);
    expect(existsSync(join(corpus, "INDEX.md"))).toBe(false);

    const drafted = python(
      [
        join(BIN, "new-adr"),
        "--corpus",
        "src/features/accounting",
        "Ledger entries are appended, never edited",
      ],
      repo,
    );

    expect(drafted.status).toBe(0);

    const draft = (drafted.stdout ?? "").trim();
    expect(draft).not.toBe("");
    writeFileSync(draft, LEDGER_DRAFT);

    const landed = python([join(BIN, "new-adr"), "--land", draft], repo);
    const feature = join(repo, "src", "features", "accounting", "docs", "adr");

    expect(landed.status).toBe(0);
    expect(
      existsSync(join(feature, "0003-ledger-entries-are-appended-never-edited.md")),
    ).toBe(true);
    expect(existsSync(join(feature, "INDEX.md"))).toBe(false);
    expect(existsSync(join(corpus, "INDEX.md"))).toBe(false);
  },
  240000,
);

test.fails(
  "#553.7: the whole check contract passes",
  () => {
    expect(probeShape().renderIndex).toBe(false);

    const harness = python([join(HOOKS, "test_adr.py")], REPO_ROOT, 420000);

    expect(harness.status).toBe(0);
  },
  600000,
);
