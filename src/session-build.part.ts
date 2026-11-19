import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, git, linesIn, plant, scratch, script } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

export const SESSION_ID = "ab12cd34";
export const EARLIER_ID = "ee11ee11";

export function sessionBuilding({ stateBefore = "OPEN", stateAfter = "CLOSED", answers = ["working", "done"], checkedOut = true, under = "Claude Projects", earlier = false }: { stateBefore?: string; stateAfter?: string; answers?: string[]; checkedOut?: boolean; under?: "Claude Projects" | ".agents"; earlier?: boolean } = {}) {
  const root = scratch("session-build-");
  const home = join(root, "home");
  const checkout = join(home, under, "mezz-checkout");
  const state = join(root, "state");
  const tree = join(checkout, ".claude", "worktrees", "build-902");
  const earlierList = earlier ? JSON.stringify([{ id: EARLIER_ID, kind: "background", cwd: tree, state: "done" }]) : "[]";
  plant(root, "state", `${stateBefore}\n`);
  for (const [dir, origin] of [[join(home, "Claude Projects", "Mezzanine"), "https://github.com/collod873/Lumaria.git"], [join(home, ".agents", "hooks"), "https://github.com/collod873/agent-hooks.git"], ...(checkedOut ? [[checkout, "https://github.com/collod873/Mezzanine.git"]] : [])] as const) {
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "--quiet");
    git(dir, "remote", "add", "origin", origin);
  }
  script(join(root, "bin", "gh"), `if [[ $1 == issue && $2 == view ]]; then cat "${state}"; exit 0; fi\nexit 1\n`);
  script(join(root, "bin", "claude-session"), `[[ $1 == new ]] || exit 1\nprintf '%s\\n' "$PWD" >"${join(root, "worktree-from")}"\nmkdir -p "$PWD/.claude/worktrees/$2"\nprintf '%s\\n' "$PWD/.claude/worktrees/$2"\n`);
  script(
    join(root, "bin", "claude"),
    [
      "case $1 in",
      `  --bg) printf '%s\\n' "$PWD" "\${GH_TOKEN-unset}" "\${GITHUB_ACTIONS-unset}" "$@" >"${join(root, "claude-call")}"; printf 'Starting background service\\nbackgrounded · ${SESSION_ID} · name\\n' ;;`,
      `  agents) [[ -e "${join(root, "claude-call")}" ]] || { printf '%s\\n' '${earlierList}'; exit 0; }; answers=(${answers.join(" ")}); polls=$(cat "${join(root, "polls")}" 2>/dev/null || echo 0); echo $((polls + 1)) >"${join(root, "polls")}"; answer=\${answers[polls]:-\${answers[-1]}}; [[ $answer == fail ]] && exit 1; (( polls + 1 >= \${#answers[@]} )) && printf '%s\\n' '${stateAfter}' >"${state}"; printf '[{"id":"zz99zz99","state":"working"},{"id":"${SESSION_ID}","state":"%s"}]\\n' "$answer" ;;`,
      `  stop) printf '%s\\n' "$2" >>"${join(root, "stopped")}" ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  script(join(root, "bin", "wt.exe"), `printf '%s\\n' "$@" >"${join(root, "window")}"\n`);
  script(join(root, "bin", "sleep"), "");
  return {
    root,
    checkout,
    tree,
    claudeCall: () => linesIn(join(root, "claude-call")),
    claudeRan: () => existsSync(join(root, "claude-call")),
    worktreeFrom: () => linesIn(join(root, "worktree-from")),
    window: () => linesIn(join(root, "window")),
    stopped: () => linesIn(join(root, "stopped")),
    run: () => execute(join(BIN, "session-build"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, HOME: home, GH_REPO: "collod873/Mezzanine", GH_TOKEN: "app-token", GITHUB_ACTIONS: "true" }, ["902"]),
  };
}

declarePart({
  part: { name: "bin/session-build", file: "bin/session-build", stops: "https://github.com/collod873/Mezzanine/issues/2980" },
  scenarios: [
    { label: "building an issue that closes", run: () => sessionBuilding().run() },
    { label: "with the issue still open after", run: () => sessionBuilding({ stateAfter: "OPEN" }).run() },
    { label: "with the session blocked on a question", run: () => sessionBuilding({ stateAfter: "OPEN", answers: ["working", "blocked"] }).run() },
    { label: "with its only checkout under ~/.agents", run: () => sessionBuilding({ under: ".agents" }).run() },
    { label: "with no checkout of the repo", run: () => sessionBuilding({ checkedOut: false }).run() },
    { label: "with a status read failing mid-build", run: () => sessionBuilding({ answers: ["fail", "working", "done"] }).run() },
    { label: "with a session from before in its worktree", run: () => sessionBuilding({ earlier: true }).run() },
  ],
});
