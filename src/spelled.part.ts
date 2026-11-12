import { join, resolve } from "node:path";
import { execute, scratch } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

const SPELLED = join(resolve(import.meta.dirname, ".."), "bin", "spelled");

declarePart({
  part: {
    name: "bin/spelled",
    file: "bin/spelled",
    stops: "https://github.com/collod873/claude-workflow/issues/1100",
    lines: 2,
    printsData: true,
  },
  scenarios: [
    { label: "printing the labels", run: () => execute(SPELLED, scratch("spelled-"), {}, ["labels"]) },
    { label: "refusing a list it does not hold", run: () => execute(SPELLED, scratch("spelled-"), {}, ["owners"]) },
  ],
});
