import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_CAP } from "./brief.ts";
import { BIN, cloned, execute, git, plant, scratch, script, stubbedMark, wellFormedSpec } from "./scenarios.ts";
import { type Comment, specIssue, SPEC_ISSUE } from "./scheduler.part.ts";
import { BUILT_CAP, handedOn, sentBack, SLICES_CAP } from "./slicer.ts";
import { PAUSED } from "./spelled.ts";
import { declareStage, HANDED_ON } from "./stages.ts";
import { SPEC_CAP } from "./ticket-shape.ts";

export const SLICING_SESSION = "slicing-session";

export function slicing({
  labels = ["spec"],
  body = wellFormedSpec,
  answers = [] as object[],
  comments = [] as Comment[],
  built = [] as string[],
  gh = "",
}: { labels?: string[] | undefined; body?: string; answers?: object[]; comments?: Comment[]; built?: string[]; gh?: string } = {}) {
  const root = scratch("slice-");
  const { session } = cloned(root, "Start");
  git(session, "checkout", "--quiet", "-b", `spec/${SPEC_ISSUE}`);
  for (const id of built) git(session, "commit", "--quiet", "--allow-empty", "-m", `Build ${id}`, "-m", `Slice: ${id}`);
  const issue = specIssue(root, { body, labels, comments, gh });
  const marked = stubbedMark(root, join(root, "hired"));
  answers.forEach((answer, at) => plant(root, `answers/${at + 1}.json`, `${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: SLICING_SESSION, structured_output: answer })}\n`));
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
  return {
    ...issue,
    marked,
    hired: () => each("hired").map((argv) => argv.split("\0")),
    handed: () => each("handed"),
    run: () => execute(join(BIN, "slice"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, MACHINE_BIN: join(root, "bin") }, [SPEC_ISSUE]),
  };
}

const SLICER_CAP = SPEC_CAP + BUILT_CAP + SLICES_CAP + 4 * HANDED_ON;
const filledSpec = (filled: Record<string, string>) => [filled.title ?? "", filled.body ?? ""] as const;
export const ANSWERED = { slices: [{ id: "seam", title: "Cut the seam", why: 'The spec asks: "a spec is filed once".', decisions: [], done: ["The seam holds."], blockedBy: [], leftOf: [] }] };

declareStage({
  part: { name: "bin/slice", file: "bin/slice", stops: "https://github.com/collod873/claude-workflow/issues/674", printsData: true },
  prompts: [
    {
      name: "slicer",
      file: "src/slicer.ts",
      cap: SLICER_CAP,
      slots: ["title", "body"],
      build: (filled) => handedOn(...filledSpec(filled), { cut: "first", slices: "", built: "" }),
    },
    {
      name: "slicer re-plan",
      file: "src/slicer.ts",
      cap: SLICER_CAP,
      slots: ["title", "body", "built", "slices"],
      build: (filled) => handedOn(...filledSpec(filled), { cut: "replan", slices: filled.slices ?? "- `seam` (merged): Cut the seam.", built: filled.built ?? "" }),
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
    { label: "cutting a spec's first slices", run: () => slicing({ answers: [ANSWERED] }).run() },
    { label: "refusing a ticket", run: () => slicing({ labels: ["ticket"] }).run() },
    { label: "stopping at an issue it cannot read", run: () => slicing({ gh: "[[ $1 == issue && $2 == view ]] && exit 1" }).run() },
    { label: "standing down on paused", run: () => slicing({ labels: ["spec", PAUSED] }).run() },
  ],
});
