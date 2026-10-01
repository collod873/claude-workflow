import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { handedOn, REPLIES_CAP } from "./done-checker.ts";
import { authored, BIN, execute, issueStage, plant, type Said, script, stubbedMark, wellFormedSpec } from "./scenarios.ts";
import { declareStage, HANDED_ON } from "./stages.ts";
import { SPEC_CAP } from "./ticket-shape.ts";

export const DONE_CHECK_POSTED = "https://github.com/collod873/claude-workflow/issues/974#issuecomment-1";

export function specWith(sentences: string[]): string {
  const [head] = wellFormedSpec.split("## I'll know it works when I can");
  return `${head}## I'll know it works when I can\n\n${sentences.map((sentence) => `- [ ] ${sentence}`).join("\n")}\n`;
}

export function doneChecking({
  labels = ["spec"],
  body = wellFormedSpec,
  tries = [{ sentence: 1, outcome: "held", tried: "read the spec issue and saw the spec label on it" }] as { sentence: number; outcome: string; tried: string }[],
  gh = "",
  said = [] as Said[],
  slice = "exit 0\n",
  markRefusal,
}: { labels?: string[]; body?: string; tries?: { sentence: number; outcome: string; tried: string }[]; gh?: string; said?: Said[]; slice?: string; markRefusal?: string } = {}) {
  const comments = '[[ $1 == api ]] && { cat "$(dirname "$0")/../comments.json"; exit 0; }';
  const { root, argv, ...stage } = issueStage("done-check-", { title: "A spec worth trying", body, labels: labels.map((name) => ({ name })) }, { tries }, DONE_CHECK_POSTED, `${gh}\n${comments}\n`);
  plant(root, "comments.json", authored(said));
  const sliced = join(root, "sliced");
  const marked = stubbedMark(root, undefined, markRefusal);
  script(join(root, "bin", "slice"), `printf '%s\\n' "$*" >>"${sliced}"\n${slice}`);
  return {
    ...stage,
    closes: () => argv().filter((args) => args[1] === "close"),
    labelled: () => argv().filter((args) => args[1] === "edit").map((args) => args.slice(2).join(" ")),
    marked,
    sliced: () => (existsSync(sliced) ? readFileSync(sliced, "utf8").trimEnd().split("\n") : []),
    run: (...args: string[]) => execute(join(BIN, "done-check"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args.length > 0 ? args : ["974"]),
  };
}

declareStage({
  part: { name: "bin/done-check", file: "bin/done-check", stops: "https://github.com/collod873/claude-workflow/issues/1023" },
  prompts: [
    {
      name: "done checker",
      file: "src/done-checker.ts",
      cap: SPEC_CAP + REPLIES_CAP + 2 * HANDED_ON,
      slots: ["title", "body", "replies"],
      build: (filled) => handedOn(filled.title ?? "", filled.body ?? "", { replies: filled.replies ?? "" }),
    },
  ],
  scenarios: [
    { label: "closing a spec whose sentence held", run: () => doneChecking().run() },
    { label: "refusing a ticket", run: () => doneChecking({ labels: ["ticket"] }).run() },
  ],
});
