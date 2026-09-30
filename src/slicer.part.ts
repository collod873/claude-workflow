import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_CAP } from "./reviewer.ts";
import { BIN, execute, ghArgv, git, plant, scratch, script, wellFormedSpec } from "./scenarios.ts";
import { handedOn, sentBack } from "./slicer.ts";
import { declareStage, HANDED_ON } from "./stages.ts";
import { SPEC_CAP } from "./ticket-shape.ts";

export const SLICING_SESSION = "slicing-session";

const WAVE_URL = "https://github.com/collod873/claude-workflow/issues/";

export function slicing({
  labels = ["spec"],
  title = "A spec worth slicing",
  body = wellFormedSpec,
  answers = [] as object[],
  gh = "",
}: { labels?: string[]; title?: string; body?: string; answers?: object[]; gh?: string } = {}) {
  const root = scratch("slice-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  git(root, "init", "--quiet", "--initial-branch=main");
  plant(root, "issue.json", JSON.stringify({ title, body, labels: labels.map((name) => ({ name })) }));
  answers.forEach((answer, at) => plant(root, `answers/${at + 1}.json`, `${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: SLICING_SESSION, structured_output: answer })}\n`));
  script(
    join(root, "bin", "gh"),
    [
      setup,
      gh,
      'case "$*" in',
      `  *"issue view"*) cat "${join(root, "issue.json")}" ;;`,
      `  *"issue create"*) mkdir -p "${join(root, "created")}"; n=$(( $(ls "${join(root, "created")}" | wc -l) + 1 )); touch "${join(root, "created")}/$n"; printf '%s%s\\n' '${WAVE_URL}' $((1100 + n)) ;;`,
      "  *sub_issues*) ;;",
      '  "api repos/{owner}/{repo}/issues/"*) printf \'%s\\n\' $(( ${2##*/} + 900000 )) ;;',
      `  *"issue comment"*) printf '%s\\n' '${WAVE_URL}968#issuecomment-1' ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  script(
    join(root, "bin", "claude"),
    [
      `mkdir -p "${join(root, "hired")}" "${join(root, "handed")}"`,
      `n=$(( $(ls "${join(root, "handed")}" | wc -l) + 1 ))`,
      `printf '%s\\0' "$@" >"${join(root, "hired")}/$n"`,
      `cat >"${join(root, "handed")}/$n"`,
      `answer="${join(root, "answers")}/$n.json"`,
      `[[ -f $answer ]] || answer="${join(root, "answers")}/${answers.length}.json"`,
      'cat "$answer"',
      "",
    ].join("\n"),
  );
  const each = (dir: string) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).map((_, at) => readFileSync(join(root, dir, String(at + 1)), "utf8")) : []);
  const bodyOf = (args: string[]) => args[args.indexOf("--body") + 1] ?? "";
  return {
    argv: calls,
    calls: () => calls().map((args) => args.slice(0, 3).join(" ")),
    hired: () => each("hired").map((argv) => argv.split("\0")),
    handed: () => each("handed"),
    rewrites: () => calls().filter((args) => args[1] === "edit" && args.includes("--body")).map(bodyOf),
    filed: () => calls().filter((args) => args[1] === "create").map((args) => ({ title: args[args.indexOf("--title") + 1], body: bodyOf(args) })),
    linked: () => calls().filter((args) => args.some((arg) => arg.includes("sub_issues"))).map((args) => args.filter((arg) => arg.includes("sub_issues") || arg.startsWith("sub_issue_id=")).join(" ")),
    comments: () => calls().filter((args) => args[1] === "comment").map(bodyOf),
    run: (...args: string[]) => execute(join(BIN, "slice"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args.length > 0 ? args : ["968"]),
  };
}

declareStage({
  part: { name: "bin/slice", file: "bin/slice", stops: "https://github.com/collod873/claude-workflow/issues/674" },
  prompts: [
    {
      name: "slicer",
      file: "src/slicer.ts",
      cap: 2 * SPEC_CAP + HANDED_ON,
      slots: ["title", "body"],
      build: (filled) => handedOn(filled.title ?? "", filled.body ?? ""),
    },
    {
      name: "slicer sent back",
      file: "src/slicer.ts",
      cap: LIST_CAP + HANDED_ON,
      slots: ["refusals"],
      build: (filled) => sentBack(filled.refusals === undefined ? [] : [filled.refusals]),
    },
  ],
  scenarios: [
    { label: "filing a wave", run: () => slicing({ answers: [{ spec: wellFormedSpec, tickets: [{ title: "File a spec", passages: [1], why: "Wave 1.", done: ["It files."] }], did: "Settled.", next: "Files it.", moves: [1] }] }).run() },
    { label: "refusing a ticket", run: () => slicing({ labels: ["ticket"] }).run() },
  ],
});
