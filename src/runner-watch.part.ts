import { watching } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

declarePart({
  part: {
    name: "bin/runner-watch",
    file: "bin/runner-watch",
    stops: "https://github.com/collod873/claude-workflow/issues/1590",
    lines: 6,
  },
  scenarios: [
    { label: "flipping a repo whose PC runners went offline", run: () => watching([{ name: "collod873/chess", runners: [{ status: "offline", labels: ["pc"] }], variable: "pc" }]).run("flip") },
    { label: "with GitHub refusing the billing usage", run: () => watching([{ name: "collod873/chess" }]).run("minutes", "collod873", "2026-10-28") },
  ],
});

declarePart({
  part: { name: "runner watch workflow", file: ".github/workflows/runner-watch.yml", stops: "https://github.com/collod873/claude-workflow/issues/1590", clock: true },
  scenarios: [],
});
