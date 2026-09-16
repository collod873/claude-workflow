import { expect, test } from "vitest";
import type { GhExec } from "../shared/gh";
import { trackerMemory } from "../shared/tracker-memory";
import { byHandStandDownBody, runReconcile } from "./reconcile";

function ghWithUnreadableRuns(): GhExec {
  const gh: GhExec = (args) => {
    if (args[0] === "issue" && args[1] === "list") return "[]";
    if (args[0] === "pr" && args[1] === "list") return "[]";
    if (args.join(" ").includes("matching-refs")) return "[]";
    throw new Error("HTTP 403: Resource not accessible by integration");
  };
  return gh;
}

test("#390.1: an unreadable runs list no longer degrades the reconcile pass", () => {
  const outcome = runReconcile({ gh: ghWithUnreadableRuns(), log: () => {}, dryRun: true });

  expect(outcome.note).not.toContain("the runs API did not return a readable list");
  expect(outcome.action).not.toBe("degraded");
});

const IMMUTABLE_SET_SOURCE = ".Workflow/agent-workflows/shared/immutable-set.json";

test("#585.3: the by-hand stand-down comment states the rule from the set's own source rather than restating it, naming the same file and act", () => {
  const body = byHandStandDownBody();

  expect(body).toContain(IMMUTABLE_SET_SOURCE);
  expect(body).toMatch(/commit/i);
});

function ghAnsweringOnlyPlainLists(): GhExec {
  return (args) => {
    if (args[0] === "issue" && args[1] === "list") {
      const fields = args[args.indexOf("--json") + 1] ?? "";
      if (fields.includes("comments")) return "[]";
      return JSON.stringify([{ number: 20, title: "A slice", body: "", labels: [] }]);
    }
    if (args[0] === "pr" && args[1] === "list") return "[]";
    if (args[0] === "run" && args[1] === "list") return "[]";
    throw new Error("HTTP 403: Resource not accessible by integration");
  };
}

test.fails("#610.3: runReconcile takes a tracker directly instead of always building trackerGh(gh) itself, so a tracker call never has to survive an unreadable gh answer underneath it", () => {
  const input = { gh: ghAnsweringOnlyPlainLists(), tracker: trackerMemory(), log: () => {}, dryRun: true };

  const outcome = runReconcile(input);

  expect(outcome.action).not.toBe("degraded");
});
