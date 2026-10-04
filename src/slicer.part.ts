import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_CAP } from "./reviewer.ts";
import { authored, BIN, execute, ghArgv, git, plant, type Said, scratch, script, stubbedMark, wellFormedSpec } from "./scenarios.ts";
import { COMMENTS_CAP, handedOn, sentBack } from "./slicer.ts";
import { NEEDS_HUMAN } from "./spelled.ts";
import { declareStage, HANDED_ON } from "./stages.ts";
import { SPEC_CAP } from "./ticket-shape.ts";
import { DIFF_CAP, FOUND_CAP } from "./wave.ts";

export const SLICING_SESSION = "slicing-session";

const WAVE_URL = "https://github.com/collod873/claude-workflow/issues/";

export function slicing({
  labels = ["spec"],
  title = "A spec worth slicing",
  body = wellFormedSpec,
  answers = [] as object[],
  gh = "",
  issues = {} as Record<string, object>,
  comments = {} as Record<string, Said[]>,
  open = [] as object[],
  prs = {} as Record<string, object>,
  diffs = {} as Record<string, string>,
  markRefusal,
}: { labels?: string[]; title?: string; body?: string; answers?: object[]; gh?: string; issues?: Record<string, object>; comments?: Record<string, Said[]>; open?: object[]; prs?: Record<string, object>; diffs?: Record<string, string>; markRefusal?: string } = {}) {
  const root = scratch("slice-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  git(root, "init", "--quiet", "--initial-branch=main");
  plant(root, "issue.json", JSON.stringify({ title, body, labels: labels.map((name) => ({ name })) }));
  for (const [path, issue] of Object.entries(issues)) plant(root, `issues/${path.replace("/", "-")}`, JSON.stringify(issue));
  for (const [number, said] of Object.entries(comments)) plant(root, `comments/${number}`, authored(said));
  for (const [number, pr] of Object.entries(prs)) plant(root, `prs/${number}`, JSON.stringify({ ...pr, files: (pr as { files?: string[] }).files?.map((path) => ({ path })) }));
  for (const [number, diff] of Object.entries(diffs)) plant(root, `diffs/${number}`, diff);
  plant(root, "open.json", JSON.stringify(open));
  const marked = stubbedMark(root, undefined, markRefusal);
  answers.forEach((answer, at) => plant(root, `answers/${at + 1}.json`, `${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: SLICING_SESSION, structured_output: answer })}\n`));
  script(
    join(root, "bin", "gh"),
    [
      setup,
      gh,
      "n=$(grep -oE 'issues/[0-9]+' <<<\"$*\" | head -1)",
      "n=${n#issues/}",
      'case "$*" in',
      `  *"issue view"*) cat "${join(root, "issue.json")}" ;;`,
      `  "api --paginate "*/sub_issues*) jq -c '.[] | {number, title, state, state_reason}' <<<"$(cat "${join(root, "issues")}/$n-sub_issues" 2>/dev/null || echo '[]')" ;;`,
      `  "api --paginate "*/comments*) cat "${join(root, "comments")}/$n" 2>/dev/null || true ;;`,
      `  "issue list"*) jq -c '.[]' "${join(root, "open.json")}" ;;`,
      `  "pr view"*) f="${join(root, "prs")}/\${3#ticket/}"; [[ -f $f ]] && cat "$f" || { printf 'no pull requests found for branch "%s"\\n' "$3" >&2; exit 1; } ;;`,
      `  "pr diff"*) f="${join(root, "diffs")}/\${3#ticket/}"; [[ -f $f ]] && cat "$f" || [[ -f "${join(root, "prs")}/\${3#ticket/}" ]] || { printf 'no pull requests found for branch "%s"\\n' "$3" >&2; exit 1; } ;;`,
      `  *"issue create"*) mkdir -p "${join(root, "created")}"; n=$(( $(ls "${join(root, "created")}" | wc -l) + 1 )); touch "${join(root, "created")}/$n"; printf '%s%s\\n' '${WAVE_URL}' $((1100 + n)) ;;`,
      "  *sub_issues*) ;;",
      '  "api repos/{owner}/{repo}/issues/"*" --jq .id") printf \'%s\\n\' $(( ${2##*/} + 900000 )) ;;',
      `  "api repos/{owner}/{repo}/issues/"*) p=\${2#*issues/}; f="${join(root, "issues")}/\${p//\\//-}"; [[ -f $f ]] && cat "$f" || { printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1; } ;;`,
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
    linked: () => calls().filter((args) => args.includes("POST")).map((args) => args.filter((arg) => arg.includes("sub_issues") || arg.startsWith("sub_issue_id=")).join(" ")),
    comments: () => calls().filter((args) => args[1] === "comment").map(bodyOf),
    marked,
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
      name: "re-slice",
      file: "src/slicer.ts",
      cap: 2 * SPEC_CAP + COMMENTS_CAP + FOUND_CAP + DIFF_CAP + 2 * HANDED_ON,
      slots: ["title", "body", "comments", "tickets", "diffs"],
      build: (filled) => handedOn(filled.title ?? "", filled.body ?? "", { comments: [filled.comments ?? ""], tickets: filled.tickets ?? "", diffs: filled.diffs ?? "", missed: [], fix: false }),
    },
    {
      name: "fix wave",
      file: "src/slicer.ts",
      cap: 2 * SPEC_CAP + COMMENTS_CAP + FOUND_CAP + DIFF_CAP + 2 * HANDED_ON,
      slots: ["title", "body", "comments", "tickets", "diffs"],
      build: (filled) => handedOn(filled.title ?? "", filled.body ?? "", { comments: [filled.comments ?? ""], tickets: filled.tickets ?? "", diffs: filled.diffs ?? "", missed: [1], fix: true }),
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
    { label: "stopping at an issue it cannot read", run: () => slicing({ gh: "[[ $1 == issue && $2 == view ]] && exit 1" }).run() },
    { label: "standing down on needs-human", run: () => slicing({ labels: ["spec", NEEDS_HUMAN] }).run() },
    { label: "ending no wave for an issue under no spec", run: () => slicing().run("--ended", "1500") },
  ],
});
