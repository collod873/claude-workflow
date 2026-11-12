import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, scratch, type Run } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

function woke(event: string): Run {
  const root = scratch("wake-");
  writeFileSync(join(root, "event.json"), event);
  return execute(join(BIN, "wake"), root, { GITHUB_EVENT_PATH: join(root, "event.json"), GITHUB_OUTPUT: join(root, "output") });
}

declarePart({
  part: {
    name: "bin/wake",
    file: "bin/wake",
    stops: "https://github.com/collod873/claude-workflow/issues/1713",
    lines: 3,
    printsData: true,
  },
  scenarios: [
    { label: "answering an event", run: () => woke(JSON.stringify({ action: "labeled", label: { name: "ticket" }, sender: { login: "collod873" }, issue: { labels: [{ name: "ticket" }] } })) },
    { label: "with an event it cannot read", run: () => woke("{") },
  ],
});
