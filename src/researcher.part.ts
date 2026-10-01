import { join } from "node:path";
import { handedOn, NOTE_CAP, OUT_OF_TIME } from "./researcher.ts";
import { BIN, execute, issueStage, stubbedMark, wellFormedNote } from "./scenarios.ts";
import { declareStage, HANDED_ON } from "./stages.ts";

export const READING_SESSION = "reading-session";

export const FINDINGS_POSTED ="https://github.com/collod873/claude-workflow/issues/902#issuecomment-1";

export function researching({
  labels = ["note", "research"],
  findings = "The closer judges only an issue with checks, so a note waits on a session.",
  gh = "",
  sources = "",
  readsPastCap = false,
}: { labels?: string[]; findings?: string; gh?: string; sources?: string; readsPastCap?: boolean } = {}) {
  const cutOff = readsPastCap ? `case "$*" in *--resume*) ;; *) printf '%s\\n' '${JSON.stringify({ type: "system", session_id: READING_SESSION })}'; exit 124 ;; esac\n` : "";
  const { root, ...stage } = issueStage("research-", { title: "What does the closer judge", body: wellFormedNote, labels: labels.map((name) => ({ name })) }, { findings }, FINDINGS_POSTED, gh, cutOff);
  const marked = stubbedMark(root, join(root, "claude-argv"));
  return {
    ...stage,
    marked,
    run: (...args: string[]) => execute(join(BIN, "research"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, RESEARCH_SOURCES: sources, STAGE_MINUTES: readsPastCap ? "40" : "" }, args.length > 0 ? args : ["902"]),
  };
}

declareStage({
  part: { name: "bin/research", file: "bin/research", stops: "https://github.com/collod873/claude-workflow/issues/902" },
  prompts: [
    {
      name: "researcher",
      file: "src/researcher.ts",
      cap: NOTE_CAP + HANDED_ON,
      slots: ["title", "body", "sources"],
      build: (filled) => handedOn(filled.title ?? "", filled.body ?? "", filled.sources ?? ""),
    },
    { name: "researcher out of time", file: "src/researcher.ts", cap: HANDED_ON, slots: [], build: () => OUT_OF_TIME },
  ],
  scenarios: [
    { label: "answering a research note", run: () => researching().run() },
    { label: "refusing a ticket", run: () => researching({ labels: ["building"] }).run() },
  ],
});
