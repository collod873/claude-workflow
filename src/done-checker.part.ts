import { join } from "node:path";
import { LIST_CAP } from "./brief.ts";
import { handedOn, OUT_OF_TIME, REPLIES_CAP } from "./done-checker.ts";
import { authored, BIN, execute, issueStage, plant, type Said, stubbedMark, wellFormedSpec } from "./scenarios.ts";
import { PAUSED, STUCK } from "./spelled.ts";
import { declarePart, HANDED_ON } from "./part-files.ts";
import { SPEC_CAP } from "./ticket-shape.ts";

export const DONE_CHECK_POSTED = "https://github.com/collod873/claude-workflow/issues/974#issuecomment-1";

export const TRYING_SESSION = "trying-session";

export const BUG_FILED = "https://github.com/collod873/claude-workflow/issues/990";

export function specWith(sentences: string[], stories: string[] = []): string {
  const [head = ""] = wellFormedSpec.split("## I'll know it works when I can");
  const told = stories.length === 0 ? "Told by the sentences below." : stories.map((story, at) => `${at + 1}. ${story}`).join("\n");
  return `${head.replace(/## User Stories\n\n[\s\S]*?\n\n(?=## )/, `## User Stories\n\n${told}\n\n`)}## I'll know it works when I can\n\n${sentences.map((sentence) => `- [ ] ${sentence}`).join("\n")}\n`;
}

export function doneChecking({
  labels = ["spec"],
  body = specWith(["see a spec land as its own issue, labelled spec"]),
  tries = [{ sentence: 1, outcome: "held", tried: "read the spec issue and saw the spec label on it" }] as { sentence: number; outcome: string; tried: string }[],
  gh = "",
  said = [] as Said[],
  markRefusal,
  contract,
  calledFrom,
  triesPastCap = false,
  unsetKeys = "",
  state = "OPEN",
}: { labels?: string[] | undefined; body?: string; tries?: { sentence: number; outcome: string; tried: string }[]; gh?: string; said?: Said[]; markRefusal?: string; contract?: string; calledFrom?: string; triesPastCap?: boolean; unsetKeys?: string; state?: string } = {}) {
  const comments = `[[ $* == *'--jq .id'* ]] && { echo 4242; exit 0; }\n[[ $1 == api ]] && { cat "$(dirname "$0")/../comments.json"; exit 0; }\n[[ $1 == issue && $2 == create ]] && { echo ${BUG_FILED}; exit 0; }`;
  const cutOff = triesPastCap ? `case "$*" in *--resume*) ;; *) printf '%s\\n' '${JSON.stringify({ type: "system", session_id: TRYING_SESSION })}'; exit 124 ;; esac\n` : "";
  const { root, argv, ...stage } = issueStage("done-check-", { title: "A spec worth trying", body, labels: labels.map((name) => ({ name })), state }, { tries }, DONE_CHECK_POSTED, `${gh}\n${comments}\n`, cutOff);
  plant(root, "comments.json", authored(said));
  const marked = stubbedMark(root, undefined, markRefusal);
  if (contract !== undefined) plant(root, ".claude/contract.json", contract);
  return {
    ...stage,
    root,
    closes: () => argv().filter((args) => args[1] === "close"),
    argv,
    created: () => argv().filter((args) => args[1] === "create"),
    marked,
    run: (...args: string[]) => execute(join(BIN, "done-check"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, STAGE_MINUTES: triesPastCap ? "40" : "", UNSET_KEYS: unsetKeys, ...(calledFrom === undefined ? {} : { CALLED_FROM: calledFrom }) }, args.length > 0 ? args : ["974"]),
  };
}

declarePart({
  part: { name: "bin/done-check", file: "bin/done-check", stops: "https://github.com/collod873/claude-workflow/issues/1023" },
  prompts: [
    {
      name: "done checker",
      file: "src/done-checker.ts",
      cap: 2 * SPEC_CAP + REPLIES_CAP + LIST_CAP + 2 * HANDED_ON,
      slots: ["title", "body", "replies", "unset"],
      build: (filled) => handedOn(filled.title ?? "", filled.body ?? "", { replies: filled.replies ?? "", foreign: true, unset: [filled.unset ?? "KEY"] }),
    },
    {
      name: "done checker on this repo",
      file: "src/done-checker.ts",
      cap: 2 * SPEC_CAP + REPLIES_CAP + 2 * HANDED_ON,
      slots: ["title", "body", "replies"],
      build: (filled) => handedOn(filled.title ?? "", filled.body ?? "", { replies: filled.replies ?? "" }),
    },
    { name: "done checker out of time", file: "src/done-checker.ts", cap: HANDED_ON, slots: [], build: () => OUT_OF_TIME },
  ],
  scenarios: [
    { label: "closing a spec whose sentence held", run: () => doneChecking().run() },
    { label: "refusing a ticket", run: () => doneChecking({ labels: ["ticket"] }).run() },
    { label: "stopping at an issue it cannot read", run: () => doneChecking({ gh: "[[ $1 == issue && $2 == view ]] && exit 1" }).run() },
    { label: "standing down on stuck", run: () => doneChecking({ labels: ["spec", STUCK] }).run() },
    { label: "standing down on paused", run: () => doneChecking({ labels: ["spec", PAUSED] }).run() },
  ],
});
