import { sessionExtras } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

declarePart({
  part: {
    name: "bin/session-extras",
    file: "bin/session-extras",
    stops: "https://github.com/collod873/claude-workflow/issues/869",
    lines: 3,
  },
  scenarios: [
    { label: "with every reminder due", run: () => sessionExtras({ mainMoves: "package-lock.json", live: 1, gh: `printf '#${"1".repeat(6)}\\n%.0s' {1..40}\nexit 0\n` }).run() },
    { label: "with the land PR lookup refused", run: () => sessionExtras({ gh: "printf 'gh: authentication required\\n' >&2\nexit 4\n" }).run() },
  ],
});
