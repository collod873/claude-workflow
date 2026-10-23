import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_PASSES } from "./builder.part.ts";
import { LIST_CAP, onDisk, TAIL_CAP, TICKET_CAP } from "./brief.ts";
import { CARRY_ON, conflicted, handedOn, mergesRefused, nothingBuilt, repaired } from "./slice-builder.ts";
import { BIN, execute, ghArgv, git, plant, scratch, script } from "./scenarios.ts";
import { declareStage, HANDED_ON } from "./stages.ts";

export const SPEC = "1509";
export const SLICE = "tenant-time-zone";
export const ONTO = `spec/${SPEC}`;
export const SLICE_SESSION = "sess-slice";
export const BRIEF = ["# Show each tenant's time zone", "", "## Why", "", 'The owner: "every job time reads in the tenant\'s own zone".', "", "## Done when", "", "- A job time shows in the tenant's zone.", "", "## Out of Scope", "", "- Changing a tenant's zone.", ""].join("\n");
export const BUILDS = "printf 'export const zone = \"%s\";\\n' \"$CALL\" >src/zone.ts\ngit add --all\ngit commit --quiet -m \"Show the tenant's time zone\"\n";

export type Answered = { outcome: string; reason: string; left?: string } | undefined;

export function slicing({
  answers = [{ outcome: "built", reason: "a job time shows in the tenant's zone" }] as Answered[],
  claude = BUILDS,
  check = CHECK_PASSES,
  contract = undefined as string | undefined,
  slice = SLICE,
  elsewhere = undefined as Record<string, string> | undefined,
  stageMinutes = "",
  appKeyFile = undefined as string | undefined,
  savedSession = undefined as string | undefined,
  containers = [] as string[][],
  root = scratch("slice-builder-"),
} = {}) {
  const repo = join(root, "repo");
  const tree = join(root, slice);
  const home = join(root, "home");
  const temp = join(root, "tmp");
  const kept = (what: string) => join(root, `${what}-${slice}`);
  const at = (what: string) => `${root}/${what}-$(basename "$PWD")`;
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  for (const dir of [kept("claude-calls"), kept("claude-argv"), kept("envs"), temp]) mkdirSync(dir, { recursive: true });
  const envKept = (who: string) => `env >"${at("envs")}/${who}-$(ls "${at("envs")}" | grep -c "^${who}-")"\n`;
  if (!existsSync(repo)) {
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "--quiet", "--initial-branch=main");
    git(repo, "config", "user.email", "slicer@test");
    git(repo, "config", "user.name", "slicer");
    plant(repo, "src/zone.ts", "export const zone = \"UTC\";\n");
    if (contract !== undefined) plant(repo, ".claude/contract.json", contract);
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "what the spec stands on");
    git(repo, "branch", ONTO);
    if (elsewhere !== undefined) {
      git(repo, "checkout", "--quiet", "-b", "elsewhere");
      for (const [path, content] of Object.entries(elsewhere)) plant(repo, path, content);
      git(repo, "add", ".");
      git(repo, "commit", "--quiet", "-m", "Another slice lands first");
      git(repo, "checkout", "--quiet", "main");
    }
  }
  git(repo, "worktree", "add", "--quiet", "-b", `slice/${SPEC}-${slice}`, tree, ONTO);
  plant(root, `brief-${slice}.md`, BRIEF);
  if (containers.length > 0) plant(root, "containers", containers.map((fields) => `${fields.join("\t")}\n`).join(""));
  if (savedSession !== undefined) plant(home, `.claude/slice-builder/collod873-Lumaria/${SPEC}/${slice}`, `${savedSession}\n`);
  answers.forEach((answer, round) => {
    const events = [{ type: "system", session_id: SLICE_SESSION }, ...(answer === undefined ? [] : [{ type: "result", subtype: "success", is_error: false, session_id: SLICE_SESSION, structured_output: answer }])];
    plant(root, `answer-${slice}-${round + 1}.jsonl`, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  });
  script(join(root, "bin", "check"), `printf 'check%s\\n' "\${*:+ $*}" >>"${at("check-calls")}"\n${envKept("check")}${check}`);
  script(join(root, "bin", "docker"), `printf '%s\\n' "$*" >>"${at("docker-calls")}"\ncase $1 in\n  port) printf '127.0.0.1:49153\\n' ;;\n  ps) cat "${root}/containers" 2>/dev/null ;;\nesac\n`);
  script(join(root, "bin", "gh"), [setup, 'case "$*" in', "  *\"repos/{owner}/{repo}/installation\"*) printf '4242\\n' ;;", "  *\"app/installations/4242/access_tokens\"*) printf 'minted-%s\\n' \"$n\" ;;", "esac", ""].join("\n"));
  plant(root, `claude-${slice}.sh`, claude);
  script(
    join(root, "bin", "claude"),
    [
      `CALL=$(( $(ls "${at("claude-calls")}" | wc -l) + 1 ))`,
      `printf '%s\\0' "$@" >"${at("claude-argv")}/$CALL"`,
      envKept("claude"),
      `cat >"${at("claude-calls")}/$CALL"`,
      `. "${at("claude")}.sh"`,
      `answer="${at("answer")}-$CALL.jsonl"`,
      `[ -f "$answer" ] || answer=$(ls "${at("answer")}"-*.jsonl | sort -V | tail -n 1)`,
      'cat "$answer"',
      "",
    ].join("\n"),
  );
  const listed = (file: string) => (onDisk(file) ?? "").split("\n").filter((line) => line !== "");
  const numbered = (dir: string) =>
    readdirSync(dir)
      .sort((one, other) => Number(one) - Number(other))
      .map((call) => readFileSync(join(dir, call), "utf8"));
  const env = { PATH: `${join(root, "bin")}:${process.env.PATH}`, HOME: home, TMPDIR: temp, RUNNER_TEMP: temp, GITHUB_RUN_ID: "7001", GITHUB_RUN_ATTEMPT: "1", GITHUB_REPOSITORY: "collod873/Lumaria", RUNNER_NAME: "GitHub Actions 7", STAGE_MINUTES: stageMinutes, ...(appKeyFile === undefined ? {} : { APP_KEY_FILE: appKeyFile, GH_TOKEN: "job-token", QUIET_GH_TOKEN: "job-token" }) };
  const argv = (extra: string[]) => ["--spec", SPEC, "--slice", slice, "--brief", join(root, `brief-${slice}.md`), "--onto", ONTO, ...extra];
  return {
    tree,
    temp,
    calls,
    handed: () => numbered(kept("claude-calls")),
    hired: () => numbered(kept("claude-argv")).map((args) => args.split("\0").filter((part) => part !== "")),
    ranWith: (who: string) =>
      readdirSync(kept("envs"))
        .filter((name) => name.startsWith(`${who}-`))
        .sort((one, other) => Number(one.split("-")[1]) - Number(other.split("-")[1]))
        .map((name) => readFileSync(join(kept("envs"), name), "utf8")),
    checked: () => listed(kept("check-calls")),
    dockered: () => listed(kept("docker-calls")),
    keptSession: () => {
      const file = join(home, ".claude", "slice-builder", "collod873-Lumaria", SPEC, slice);
      return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
    },
    log: (...args: string[]) => git(tree, ...args),
    command: (...extra: string[]) => [join(BIN, "build-slice"), ...argv(extra)].map((part) => `'${part}'`).join(" "),
    env,
    run: (...extra: string[]) => execute(join(BIN, "build-slice"), tree, env, argv(extra)),
  };
}

declareStage({
  part: { name: "bin/build-slice", file: "bin/build-slice", stops: "https://github.com/collod873/claude-workflow/issues/1509", lines: 2, printsData: true },
  prompts: [
    {
      name: "slice builder building",
      file: "src/slice-builder.ts",
      cap: TICKET_CAP + HANDED_ON,
      slots: ["brief"],
      build: (filled) => handedOn({ spec: "", slice: "", onto: "", brief: filled.brief ?? "", commitlint: true }),
    },
    { name: "slice repair", file: "src/slice-builder.ts", cap: TAIL_CAP + HANDED_ON, slots: ["output"], build: (filled) => repaired(filled.output ?? "") },
    { name: "slice conflict", file: "src/slice-builder.ts", cap: LIST_CAP + HANDED_ON, slots: ["files"], build: (filled) => conflicted("", filled.files ?? "") },
    { name: "slice merges refused", file: "src/slice-builder.ts", cap: LIST_CAP + HANDED_ON, slots: ["merges"], build: (filled) => mergesRefused("", filled.merges ?? "") },
    { name: "slice nothing built", file: "src/slice-builder.ts", cap: HANDED_ON, slots: [], build: () => nothingBuilt("") },
    { name: "slice carry on", file: "src/slice-builder.ts", cap: HANDED_ON, slots: [], build: () => CARRY_ON },
  ],
  scenarios: [
    { label: "building a slice", run: () => slicing().run() },
    { label: "with its builder stuck", run: () => slicing({ answers: [{ outcome: "stuck", reason: "the zone has no source" }] }).run() },
    { label: "refusing a call it does not take", run: () => slicing().run("--slice", "Not Kebab") },
  ],
});
