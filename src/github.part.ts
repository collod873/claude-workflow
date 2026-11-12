import { NOISE, githubCall } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

declarePart({
  part: {
    name: "bin/github",
    file: "bin/github",
    stops: "https://github.com/collod873/claude-workflow/issues/1206",
    lines: 4,
  },
  scenarios: [
    { label: "answering after two blips", run: () => githubCall(["gh: Server Error (HTTP 502)", "gh: Server Error (HTTP 502)"]).run() },
    { label: "refused, not on a blip", run: () => githubCall([NOISE.split("\n")[0] ?? ""]).run() },
    { label: "refused past a blip", run: () => githubCall(["gh: Server Error (HTTP 502)", "gh: Server Error (HTTP 502)", "gh: Server Error (HTTP 502)"]).run() },
  ],
});
