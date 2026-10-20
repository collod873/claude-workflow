import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, cloned, execute, ghArgv, git, plant, scratch, script } from "./scenarios.ts";
import { ENROLLED_REVIEW } from "./post.ts";
import { declareStage } from "./stages.ts";

const ROLLUPS = {
  green: [{ context: "check", state: "SUCCESS" }, { name: ENROLLED_REVIEW, status: "COMPLETED", conclusion: "SUCCESS" }],
  pending: [{ context: "check", state: "PENDING" }],
  red: [{ context: "check", state: "FAILURE" }, { name: ENROLLED_REVIEW, status: "COMPLETED", conclusion: "SUCCESS" }],
} as const;

export function pausing({ pr = "green" as keyof typeof ROLLUPS | "none" | "unreadable", state = "OPEN", autoMerge = true, refused = "", calledFrom = "", behind = false, pushRefused = "", held = "", conflicted = false } = {}) {
  const root = scratch("pause-");
  const { remote, session } = cloned(root, "base");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  const marks = join(root, "marks");
  git(session, "checkout", "--quiet", "-b", "ticket/811");
  if (conflicted) plant(session, "src/clash.ts", 'export const clash = "ticket";\n');
  git(session, "add", "-A");
  git(session, "commit", "--quiet", "--allow-empty", "-m", "Build #811 against its failing tests");
  git(session, "push", "--quiet", "origin", "ticket/811");
  const head = git(session, "rev-parse", "HEAD");
  git(session, "checkout", "--quiet", "main");
  if (behind) {
    if (conflicted) plant(session, "src/clash.ts", 'export const clash = "main";\n');
    git(session, "add", "-A");
    git(session, "commit", "--quiet", "--allow-empty", "-m", "main moved on");
    git(session, "push", "--quiet", "origin", "main");
  }
  if (pushRefused !== "") script(join(remote, "hooks", "pre-receive"), `cat >/dev/null\nprintf '%s\\n' '${pushRefused}' >&2\nexit 1\n`);
  const viewed =
    pr === "none"
      ? "printf 'no pull requests found for branch \"ticket/811\"\\n' >&2; exit 1"
      : pr === "unreadable"
        ? "printf 'gh: Bad credentials (HTTP 401)\\n' >&2; exit 1"
        : `printf '%s\\n' '${JSON.stringify({ number: 931, state, headRefOid: head, autoMergeRequest: autoMerge ? { mergeMethod: "MERGE" } : null, mergeStateStatus: behind ? "BEHIND" : "CLEAN", statusCheckRollup: ROLLUPS[pr], mergeCommit: state === "MERGED" ? { oid: head } : null })}'`;
  script(
    join(root, "bin", "gh"),
    [setup, 'case "$*" in', `  *"pr view"*) ${viewed} ;;`, `  *"issue view"*) printf '%s' '${held}' ;;`, "  *\"issue list\"*) printf '[]' ;;", ...(refused === "" ? [] : [`  *"pr merge"*|*"workflow run"*) printf '%s\\n' '${refused}' >&2; exit 1 ;;`]), "esac", ""].join("\n"),
  );
  script(join(root, "bin", "mark"), `printf '%s\\n' "$*" >>"${marks}"\n`);
  script(join(root, "bin", "check"), "printf 'check: ok, 2 steps in 0.3s\\n'\n");
  const env = { PATH: `${join(root, "bin")}:${process.env.PATH}`, MACHINE_BIN: join(root, "bin"), ...(calledFrom === "" ? {} : { CALLED_FROM: calledFrom }) };
  return {
    head,
    calls,
    marks: () => (existsSync(marks) ? readFileSync(marks, "utf8").trim().split("\n") : []),
    branchHead: () => git(session, "--git-dir", remote, "rev-parse", "refs/heads/ticket/811"),
    pause: () => execute(join(BIN, "pause"), session, env, ["811"]),
    resume: () => execute(join(BIN, "resume"), session, env, ["811"]),
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
