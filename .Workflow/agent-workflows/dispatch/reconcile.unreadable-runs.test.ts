import { expect, test } from "vitest";
import type { GhExec } from "../shared/gh";
import { runReconcile } from "./reconcile";

function ghWithUnreadableRuns(): GhExec {
  const gh: GhExec = (args) => {
    if (args[0] === "issue" && args[1] === "list") return "[]";
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
