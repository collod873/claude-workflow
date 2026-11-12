import { switching } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

declarePart({
  part: {
    name: "bin/runner",
    file: "bin/runner",
    stops: "https://github.com/collod873/claude-workflow/issues/1257",
  },
  scenarios: [
    { label: "installing a repo's PC runners and sending its jobs there", run: () => switching().run("pc") },
    { label: "refusing a public repo", run: () => switching({ isPrivate: false }).run("pc") },
  ],
});
