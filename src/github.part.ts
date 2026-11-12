import { join } from "node:path";
import { BIN, NOISE, execute, ghArgv, scratch, script } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

export function githubCall(refusals: string[], args = ["issue", "edit", "1202", "--add-label", "landing"]) {
  const root = scratch("github-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  script(
    join(root, "bin", "gh"),
    [setup, `refusals=(${refusals.map((refusal) => `'${refusal}'`).join(" ")})`, "refusal=${refusals[$((n - 1))]:-}", '[[ -z $refusal ]] && { printf "answered\\n"; exit 0; }', 'printf "partial\\n"', 'printf "%s\\n" "$refusal" >&2', "exit 1", ""].join("\n"),
  );
  const run = () => execute(join(BIN, "github"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_RETRY_SECONDS: "0" }, args);
  return { run, calls };
}

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
