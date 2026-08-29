import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { jobs, repoRoot, workflowPath } from "./workflow-shape.fixture";

const toTicketsDir = path.join(repoRoot, ".Workflow", "agent-workflows", "to-tickets");
const toTicketsYml = workflowPath("to-tickets.yml");
const dispatchRequest = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "dispatch-request.ts",
);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("#201 lane 04 first authoring — lane 03 asks for it", () => {
  // - [ ] Lane 03's `contents: write` dispatch job sends that request, one per slice, through `shared/dispatch-request.ts`; the model job writes it, never sends it (ADR-0091) — check: `grep -rq "acceptance-wanted" .Workflow/agent-workflows/to-tickets/`
  it("Lane 03's `contents: write` dispatch job sends that request, one per slice, through `shared/dispatch-request.ts`; the model job writes it, never sends it (ADR-0091)", () => {
    // The model job writes the request: lane 03's prompt/instruction files name it.
    const authored = walk(toTicketsDir).filter((f) =>
      readFileSync(f, "utf8").includes("acceptance-wanted"),
    );
    expect(
      authored.length,
      "a file under .Workflow/agent-workflows/to-tickets/ names the acceptance-wanted request",
    ).toBeGreaterThan(0);

    // One request per slice, not one per run.
    const perSlice = authored.some((f) => /per[- ]slice|one per slice|each slice|for each slice/i.test(readFileSync(f, "utf8")));
    expect(perSlice, "lane 03 is told to write one acceptance-wanted request per slice").toBe(true);

    // Sending goes through the shared helper, from the dispatch job only.
    expect(existsSync(dispatchRequest)).toBe(true);
    expect(existsSync(toTicketsYml)).toBe(true);
    const byJob = jobs(readFileSync(toTicketsYml, "utf8"));

    // The send is `POST /dispatches`, so the job that performs it is the job naming that endpoint
    // — not the job that mentions the helper, which both jobs do by construction.
    const senders = Object.entries(byJob).filter(([, text]) => /\/dispatches/.test(text));
    expect(senders.length, "a to-tickets.yml job sends through shared/dispatch-request.ts").toBeGreaterThan(0);
    for (const [name, text] of senders) {
      expect(text, `job ${name} sends dispatches, so it holds contents: write`).toMatch(
        /contents:\s*write/,
      );
    }

    // "the model job writes it, never sends it" (ADR-0091). The model job diverts every request it
    // would otherwise send into `DISPATCH_REQUESTS_PATH` — the seam `shared/dispatch-request.ts`
    // exists for — and the sender above posts those lines verbatim. That is why no sending job
    // names `acceptance-wanted` at all: the event type lives in the file, never in the workflow.
    const writers = Object.entries(byJob).filter(([name]) => !senders.some(([s]) => s === name));
    expect(
      writers.some(([, text]) => text.includes("DISPATCH_REQUESTS_PATH")),
      "the model job records its dispatch requests rather than posting them",
    ).toBe(true);
    for (const [name, text] of writers) {
      expect(text, `model job ${name} never posts a dispatch itself`).not.toMatch(/\/dispatches/);
    }
  });
});
