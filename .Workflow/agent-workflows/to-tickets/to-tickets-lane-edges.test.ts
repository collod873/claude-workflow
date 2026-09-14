import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const docPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/agents/to-tickets-lane-edges.md",
);

test(
  "#570.1: the page names no dispatchReadySlices step and no ready flag on an acceptance-wanted payload",
  async () => {
    const doc = await readFile(docPath, "utf-8");
    expect(doc).not.toMatch(/dispatchReadySlices/);
    expect(doc).not.toMatch(/"ready"\s*:/);
  },
);

test(
  "#570.2: the page's outbound edge section names the run-ended event the wake-reconciler job sends",
  async () => {
    const doc = await readFile(docPath, "utf-8");
    expect(doc).toMatch(/run-ended/);
  },
);
