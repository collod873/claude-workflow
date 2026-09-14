import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  FAMILY_COLORS,
  LABEL_CATALOGUE,
  renderLabelsTable,
  type CatalogueLabel,
} from "../../.Workflow/agent-workflows/shared/labels";
import rawCatalogue from "../../.Workflow/agent-workflows/shared/labels.json";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHARED = join(".Workflow", "agent-workflows", "shared");
const BY_HAND = "by-hand";

const catalogue = rawCatalogue as CatalogueLabel[];

const NINTH: CatalogueLabel = {
  name: "9-ninth-owner",
  color: FAMILY_COLORS.owner,
  description: "A ninth owner label the catalogue grew",
  family: "owner",
};

const PROBE = [
  "import importlib.util, json, sys",
  "hooks, binaries, names = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])",
  "sys.path.insert(0, binaries)",
  "sys.path.insert(0, hooks)",
  "spec = importlib.util.spec_from_file_location('session_brief', hooks + '/session-brief.py')",
  "module = importlib.util.module_from_spec(spec)",
  "sys.modules['session_brief'] = module",
  "spec.loader.exec_module(module)",
  "print(json.dumps([module.owner_label_of({'labels': [{'name': name}]}) for name in names]))",
].join("\n");

function ownerLabelsSeenBy(root: string, probed: string[]): Array<string | null> {
  const out = execFileSync(
    "python3",
    ["-c", PROBE, join(root, ".claude", "hooks"), join(root, "bin"), JSON.stringify(probed)],
    { cwd: root, encoding: "utf8" },
  );
  const printed = out.trim().split("\n").at(-1) ?? "";
  return JSON.parse(printed) as Array<string | null>;
}

function sandboxCarrying(entries: CatalogueLabel[]): string {
  const root = mkdtempSync(join(tmpdir(), "session-brief-roster-"));
  const copy = { recursive: true, dereference: true } as const;
  cpSync(join(ROOT, ".claude", "hooks"), join(root, ".claude", "hooks"), copy);
  cpSync(join(ROOT, SHARED), join(root, SHARED), copy);
  if (existsSync(join(ROOT, "bin"))) cpSync(join(ROOT, "bin"), join(root, "bin"), copy);
  writeFileSync(join(root, SHARED, "labels.json"), `${JSON.stringify(entries, null, 2)}\n`);
  return root;
}

test.fails("#557.3: .claude/hooks/session-brief.py derives its owner labels by reading that file", () => {
  const root = sandboxCarrying([...LABEL_CATALOGUE, NINTH]);
  expect(ownerLabelsSeenBy(root, [NINTH.name, "needs-human", "5-building"])).toEqual([
    NINTH.name,
    "needs-human",
    null,
  ]);
});

test.fails(
  "#557.4: a label added to the catalogue reaches both the generated doc and the session brief with no second edit",
  () => {
    const rows = renderLabelsTable().split("\n").slice(3, -1);
    expect(rows).toHaveLength(catalogue.length);
    expect(new Set(rows.map((row) => row.split("|")[1].trim()))).toEqual(
      new Set(catalogue.map((label) => `\`${label.name}\``)),
    );
    const owners = new Set(catalogue.filter((label) => label.family === "owner").map((label) => label.name));
    const probed = LABEL_CATALOGUE.map((label) => label.name).filter((name) => name !== BY_HAND);
    expect(ownerLabelsSeenBy(ROOT, probed)).toEqual(probed.map((name) => (owners.has(name) ? name : null)));
  },
);
