import { join } from "node:path";
import { handedOn } from "./done-checker.ts";
import { BIN, execute, issueStage, wellFormedSpec } from "./scenarios.ts";
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
}: { labels?: string[]; body?: string; tries?: { sentence: number; outcome: string; tried: string }[]; gh?: string } = {}) {
  const { root, argv, ...stage } = issueStage("done-check-", { title: "A spec worth trying", body, labels: labels.map((name) => ({ name })) }, { tries }, DONE_CHECK_POSTED, gh);
  return {
    ...stage,
    closes: () => argv().filter((args) => args[1] === "close"),
    run: (...args: string[]) => execute(join(BIN, "done-check"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args.length > 0 ? args : ["974"]),
  };
}

declareStage({
  part: { name: "bin/done-check", file: "bin/done-check", stops: "https://github.com/collod873/claude-workflow/issues/1023" },
  prompts: [
    {
      name: "done checker",
      file: "src/done-checker.ts",
      cap: SPEC_CAP + 2 * HANDED_ON,
      slots: ["title", "body"],
      build: (filled) => handedOn(filled.title ?? "", filled.body ?? ""),
    },
  ],
  scenarios: [
    { label: "closing a spec whose sentence held", run: () => doneChecking().run() },
    { label: "refusing a ticket", run: () => doneChecking({ labels: ["ticket"] }).run() },
  ],
});
