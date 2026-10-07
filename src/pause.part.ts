import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, ghArgv, scratch, script } from "./scenarios.ts";
import { declareStage } from "./stages.ts";

export const PAUSED_HEAD = "4f2a9c1e0b7d6a5f3e2c1b0a9f8e7d6c5b4a3f2e";

const ROLLUPS = {
  green: [{ name: "check", status: "COMPLETED", conclusion: "SUCCESS" }, { name: "review", status: "COMPLETED", conclusion: "SUCCESS" }],
  pending: [{ name: "check", status: "IN_PROGRESS", conclusion: "" }],
  red: [{ name: "check", status: "COMPLETED", conclusion: "FAILURE" }, { name: "review", status: "COMPLETED", conclusion: "SUCCESS" }],
} as const;

export function pausing({ pr = "green" as keyof typeof ROLLUPS | "none" | "unreadable", state = "OPEN", autoMerge = true, refused = "", calledFrom = "", behind = false, updateRefused = "", held = "", conflicted = true } = {}) {
  const root = scratch("pause-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  const marks = join(root, "marks");
  const viewed =
    pr === "none"
      ? "printf 'no pull requests found for branch \"ticket/811\"\\n' >&2; exit 1"
      : pr === "unreadable"
        ? "printf 'gh: Bad credentials (HTTP 401)\\n' >&2; exit 1"
        : `printf '%s\\n' '${JSON.stringify({ number: 931, state, headRefOid: PAUSED_HEAD, autoMergeRequest: autoMerge ? { mergeMethod: "MERGE" } : null, mergeStateStatus: behind ? "BEHIND" : "CLEAN", statusCheckRollup: ROLLUPS[pr] })}'`;
  script(
    join(root, "bin", "gh"),
    [setup, 'case "$*" in', `  *"pr view"*) ${viewed} ;;`, `  *"issue view"*) printf '%s' '${held}' ;;`, ...(updateRefused === "" ? [] : [`  *"pr update-branch"*) printf '%s\\n' '${updateRefused}' >&2; exit 1 ;;`]), ...(refused === "" ? [] : [`  *"pr merge"*|*"workflow run"*) printf '%s\\n' '${refused}' >&2; exit 1 ;;`]), "esac", ""].join("\n"),
  );
  script(join(root, "bin", "mark"), `printf '%s\\n' "$*" >>"${marks}"\n`);
  script(join(root, "bin", "git"), `case "$*" in\n  *merge-tree*) exit ${conflicted ? 1 : 0} ;;\nesac\n`);
  const env = { PATH: `${join(root, "bin")}:${process.env.PATH}`, ...(calledFrom === "" ? {} : { CALLED_FROM: calledFrom }) };
  return {
    calls,
    marks: () => (existsSync(marks) ? readFileSync(marks, "utf8").trim().split("\n") : []),
    pause: () => execute(join(BIN, "pause"), root, env, ["811"]),
    resume: () => execute(join(BIN, "resume"), root, env, ["811"]),
  };
}

declareStage({
  part: { name: "bin/pause", file: "bin/pause", stops: "https://github.com/collod873/claude-workflow/issues/1174" },
  scenarios: [
    { label: "turning auto-merge off on a paused ticket's PR", run: () => pausing().pause() },
    { label: "with the PR unreadable", run: () => pausing({ pr: "unreadable" }).pause() },
  ],
});

declareStage({
  part: { name: "bin/resume", file: "bin/resume", stops: "https://github.com/collod873/claude-workflow/issues/902", lines: 2 },
  scenarios: [
    { label: "turning auto-merge back on at a green PR", run: () => pausing().resume() },
    { label: "waking the builder on a red PR", run: () => pausing({ pr: "red" }).resume() },
    { label: "bringing a green PR behind main up to date", run: () => pausing({ behind: true }).resume() },
    { label: "with the PR unreadable", run: () => pausing({ pr: "unreadable" }).resume() },
  ],
});
