import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { trackerMemory } from "./tracker-memory";

/**
 * @fixture Reached only from the suites, by design. `knip.config.ts` asks whether a lane reaches
 * an export, and no lane may: a stub `gh` on a lane's path would be a lane that never talked to
 * the tracker.
 */

export interface IssuePayload {
  body: string;
  comments?: { body: string; createdAt: string }[];
}

export function readArgvLog(log: string): string[][] {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as string[]);
}

export interface GhStub {
  path: string;
  calls: () => string[][];
}

export function stubGh(payload: IssuePayload | string): GhStub {
  const issue: IssuePayload = typeof payload === "string" ? { body: payload } : payload;
  const dir = mkdtempSync(join(tmpdir(), "stub-gh-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  const path = join(dir, "gh");
  const log = join(dir, "argv.jsonl");
  const ISSUE_NUMBER = 1;
  const tracker = trackerMemory({
    issues: {
      [ISSUE_NUMBER]: { body: issue.body, comments: (issue.comments ?? []).map((comment) => comment.body) },
    },
  });
  const comments = tracker.issueComments(ISSUE_NUMBER).map((body, index) => ({
    body,
    createdAt: (issue.comments ?? [])[index]?.createdAt ?? "",
  }));
  const answer = JSON.stringify(
    JSON.stringify({ body: tracker.issueBody(ISSUE_NUMBER), comments }),
  );
  writeFileSync(
    path,
    `#!/bin/bash\npython3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> ${JSON.stringify(log)}\nprintf '%s' ${answer}\n`,
  );
  chmodSync(path, 0o755);

  return { path, calls: () => readArgvLog(log) };
}
