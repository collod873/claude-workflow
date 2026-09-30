import { handedOn, METERS } from "./meter-reviewer.ts";
import { reviewing } from "./reviewer.part.ts";
import { DIFF_CAP, LIST_CAP, TICKET_CAP } from "./reviewer.ts";
import { declareStage, HANDED_ON } from "./stages.ts";

const NOTHING_METERED = Object.fromEntries(METERS.map(({ name }) => [name.replaceAll(" ", "_"), []]));

export const metering = (options: Parameters<typeof reviewing>[0] = {}) => reviewing({ bin: "meters", verdict: NOTHING_METERED, ...options });

declareStage({
  part: { name: "bin/meters", file: "bin/meters", stops: "https://github.com/collod873/claude-workflow/issues/894", lines: 5 },
  prompts: [
    {
      name: "meter reviewer",
      file: "src/meter-reviewer.ts",
      cap: 2 * TICKET_CAP + DIFF_CAP + LIST_CAP + 3 * HANDED_ON,
      slots: ["body", "diff"],
      build: (filled) => handedOn(filled.body ?? "", filled.diff ?? ""),
    },
  ],
  scenarios: [
    { label: "putting its lines on a PR body", run: () => metering().run() },
    { label: "printing its lines", run: () => metering().run("9810", {}, ["--print"]) },
    { label: "with the PR body unreadable", run: () => metering({ prBodyUnreadable: true }).run() },
  ],
});
