import { NOISE, marking } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

declarePart({
  part: {
    name: "bin/mark",
    file: "bin/mark",
    stops: "https://github.com/collod873/claude-workflow/issues/835",
  },
  scenarios: [
    { label: "moving a ticket to a state", run: () => marking({ labels: { "811": ["ticket", "checking", "try-2"] }, pr: "900" }).run("811", "building", "--try") },
    { label: "with GitHub refusing the label", run: () => marking({ gh: `cat >&2 <<'NOISE'\n${NOISE}\nNOISE\nexit 1\n` }).run("811", "stuck") },
  ],
});
