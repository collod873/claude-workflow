import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, cloned, execute, git, plant, scratch, script } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

export function sessionExtras({
  gh = "exit 0\n",
  npm = "exit 0\n",
  mainMoves = "moved.txt",
  live = 0,
}: { gh?: string; npm?: string; mainMoves?: string; live?: number } = {}) {
  const root = scratch("session-extras-");
  const { remote, session: main } = cloned(root, "base");
  const was = git(main, "rev-parse", "HEAD");
  const other = join(root, "other");
  git(root, "clone", "--quiet", remote, other);
  git(other, "config", "user.email", "other@test");
  git(other, "config", "user.name", "other");
  plant(other, mainMoves, "moved\n");
  git(other, "add", mainMoves);
  git(other, "commit", "--quiet", "-m", "a merge since the last session");
  git(other, "push", "--quiet", "origin", "main");
  git(main, "pull", "--quiet", "--ff-only", "origin", "main");
  const installed = join(root, "npm");
  script(join(root, "bin", "npm"), `printf '%s\\n' "$PWD" "$@" >"${installed}"\n${npm}`);
  script(join(root, "bin", "gh"), gh);
  return {
    main,
    npm: () => (existsSync(installed) ? readFileSync(installed, "utf8").trimEnd().split("\n") : undefined),
    run: () => execute(join(BIN, "session-extras"), main, { PATH: `${join(root, "bin")}:${process.env.PATH}`, SESSION_MAIN_WAS: was, SESSION_LIVE: String(live) }, []),
  };
}

declarePart({
  part: {
    name: "bin/session-extras",
    file: "bin/session-extras",
    stops: "https://github.com/collod873/claude-workflow/issues/869",
    lines: 3,
  },
  scenarios: [
    { label: "with every reminder due", run: () => sessionExtras({ mainMoves: "package-lock.json", live: 1, gh: `printf '#${"1".repeat(6)}\\n%.0s' {1..40}\nexit 0\n` }).run() },
    { label: "with the land PR lookup refused", run: () => sessionExtras({ gh: "printf 'gh: authentication required\\n' >&2\nexit 4\n" }).run() },
  ],
});
