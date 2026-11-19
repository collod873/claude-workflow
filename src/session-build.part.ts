import { existsSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, plant, scratch, script } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

export function sessionBuilding({ stateBefore = "OPEN", stateAfter = "CLOSED", claudeExit = 0 }: { stateBefore?: string; stateAfter?: string; claudeExit?: number } = {}) {
  const root = scratch("session-build-");
  const state = join(root, "state");
  plant(root, "state", `${stateBefore}\n`);
  const contract = JSON.stringify({ setup: "echo yes >set-up", steps: {} });
  script(
    join(root, "bin", "gh"),
    [
      `if [[ $1 == repo && $2 == clone ]]; then mkdir -p "$4/.claude" && printf '%s' '${contract}' >"$4/.claude/contract.json"; exit 0; fi`,
      `if [[ $1 == issue && $2 == view ]]; then cat "${state}"; exit 0; fi`,
      "exit 1",
      "",
    ].join("\n"),
  );
  script(join(root, "bin", "claude"), `printf '%s\\n' "$PWD" "\${GH_TOKEN-unset}" "$@" >"${join(root, "claude-call")}"\nprintf '%s\\n' '${stateAfter}' >"${state}"\nexit ${claudeExit}\n`);
  return {
    root,
    claudeRan: () => existsSync(join(root, "claude-call")),
    run: () => execute(join(BIN, "session-build"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_REPO: "collod873/Mezzanine", GH_TOKEN: "app-token", RUNNER_TEMP: join(root, "temp") }, ["902"]),
  };
}

declarePart({
  part: { name: "bin/session-build", file: "bin/session-build", stops: "https://github.com/collod873/Mezzanine/issues/2980" },
  scenarios: [
    { label: "building an issue that closes", run: () => sessionBuilding().run() },
    { label: "with the issue still open after", run: () => sessionBuilding({ stateAfter: "OPEN" }).run() },
    { label: "with the session ending red", run: () => sessionBuilding({ stateAfter: "OPEN", claudeExit: 1 }).run() },
  ],
});
