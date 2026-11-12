import { NOISE, bare, enrolling } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

declarePart({
  part: {
    name: "bin/enrol",
    file: "bin/enrol",
    stops: "https://github.com/collod873/claude-workflow/issues/1150",
    lines: 6,
  },
  scenarios: [
    { label: "enrolling a bare repo", run: () => enrolling(bare()).run() },
    { label: "with GitHub refusing every call", run: () => enrolling(bare({ refused: { "": NOISE } })).run() },
  ],
});
