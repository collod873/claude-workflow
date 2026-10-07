import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { asked, PROBE_CAP, probeOutput, probeRunName, type Probe } from "./probe.ts";
import { BIN, execute, ghArgv, git, plant, scratch, script } from "./scenarios.ts";
import { declareStage, HANDED_ON } from "./stages.ts";

export const PROBE_RUN = "4417";
const PROBE_URL = `https://github.com/collod873/Lumaria/actions/runs/${PROBE_RUN}`;

export function probing({ contract = undefined as string | undefined, said = "the check fits its budget", claudeEnds = 0, concluded = "success", listed = true, keptOutput = true, treePath = {} as Record<string, string> } = {}) {
  const root = scratch("probe-");
  const tree = join(root, "tree");
  const hires = join(root, "claude-argv");
  const handed = join(root, "claude-input");
  mkdirSync(tree, { recursive: true });
  mkdirSync(hires, { recursive: true });
  git(tree, "init", "--quiet", "--initial-branch=main");
  if (contract !== undefined) plant(tree, ".claude/contract.json", contract);
  const result = { type: "result", subtype: "success", is_error: false, session_id: "sess-probe", result: said };
  script(join(root, "bin", "claude"), [`printf '%s\\0' "$@" >"${hires}/argv"`, `cat >"${handed}"`, `printf '%s\\n' '${JSON.stringify(result)}'`, `exit ${claudeEnds}`, ""].join("\n"));
  for (const [name, body] of Object.entries(treePath)) script(join(root, "tree-bin", name), body);
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  const title = (by: Probe, text: string) => probeRunName(by, text).replaceAll("'", "'\\''");
  const ghFor = (by: Probe, text: string) =>
    script(
      join(root, "bin", "gh"),
      [
        setup,
        'case "$*" in',
        `  *"run list"*) ${listed ? `printf '[{"databaseId":${PROBE_RUN},"createdAt":"%s","displayTitle":"%s","url":"${PROBE_URL}"}]\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '${title(by, text)}'` : "printf '[]\\n'"} ;;`,
        `  *"run view"*) printf '%s\\n' '${concluded}' ;;`,
        `  *"run download"*) ${keptOutput ? `printf 'check: ok\\n' >"\${@: -1}/${probeOutput(PROBE_RUN)}"` : "true"} ;;`,
        "esac",
        "",
      ].join("\n"),
    );
  const env = { PATH: `${join(root, "bin")}:${process.env.PATH}`, PROBE_FIND_SECONDS: "0", PROBE_WATCH_SECONDS: "1", GITHUB_RUN_ID: PROBE_RUN, ...(Object.keys(treePath).length === 0 ? {} : { TREE_PATH: join(root, "tree-bin") }) };
  const logs = join(tree, ".git", "machine-logs");
  return {
    calls,
    hired: () => readFileSync(join(hires, "argv"), "utf8").split("\0").filter((part) => part !== ""),
    handed: () => readFileSync(handed, "utf8"),
    kept: () => (existsSync(join(logs, probeOutput(PROBE_RUN))) ? readFileSync(join(logs, probeOutput(PROBE_RUN)), "utf8") : undefined),
    transcripts: () => (existsSync(logs) ? readdirSync(logs).filter((name) => name.endsWith(".jsonl")) : []),
    run: (by: Probe, text: string) => execute(join(BIN, "probe"), tree, env, [by, text]),
    dispatch: (by: Probe, text: string) => {
      ghFor(by, text);
      return execute(join(BIN, "probe"), root, env, ["--in", "collod873/Lumaria", by, text]);
    },
  };
}

declareStage({
  part: { name: "bin/probe", file: "bin/probe", stops: "https://github.com/collod873/claude-workflow/issues/1251" },
  prompts: [{ name: "probe", file: "src/probe.ts", cap: PROBE_CAP + HANDED_ON, slots: ["text"], build: (filled) => asked(filled.text ?? "") }],
  scenarios: [
    { label: "probing a script", run: () => probing().run("script", "printf 'check: ok\\n'") },
    { label: "probing a script that ends red", run: () => probing().run("script", "printf 'check: red typecheck\\n'; exit 3") },
    { label: "probing through claude", run: () => probing().run("claude", "Run ~/bin/check and say how long it took") },
    { label: "with the tree's setup failing", run: () => probing({ contract: '{ "setup": "printf \'npm ci: lockfile out of date\\\\n\' >&2; exit 1" }' }).run("script", "true") },
    { label: "dispatching a probe and reading its output", run: () => probing().dispatch("script", "~/bin/check") },
    { label: "dispatching a probe that ends red", run: () => probing({ concluded: "failure" }).dispatch("script", "~/bin/check") },
  ],
});
