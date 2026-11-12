import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, NOISE, execute, linesIn, scratch, script } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

export function marking({ gh = "", labels = {}, pr = "", repo = [] }: { gh?: string; labels?: Record<string, string[]>; pr?: string; repo?: string[] } = {}) {
  const root = scratch("mark-");
  const calls = join(root, "gh-calls");
  const held = (number: string) => join(root, "labels", number);
  mkdirSync(join(root, "labels"));
  for (const [number, names] of Object.entries(labels)) writeFileSync(held(number), names.map((name) => `${name}\n`).join(""));
  writeFileSync(join(root, "repo"), repo.map((name) => `${name} ededed\n`).join(""));
  script(
    join(root, "bin", "gh"),
    [
      `printf '%s\\n' "$*" >>"${calls}"`,
      gh,
      `dir="${root}"`,
      'if [[ $1 == label && $2 == create ]]; then grep -q "^$3 " "$dir/repo" && exit 1; printf \'%s %s\\n\' "$3" "$5" >>"$dir/repo"; exit 0; fi',
      `[[ $1 == pr && $2 == list ]] && { printf '%s' '${pr}'; exit 0; }`,
      "[[ $1 == api ]] || exit 0",
      "if [[ $2 == -X ]]; then method=$3 path=$4; shift 4; else method=GET path=$2; shift 2; fi",
      'number=${path#repos/?owner?/?repo?/issues/}; number=${number%%/*}; file="$dir/labels/$number"; touch "$file"',
      "case $method in",
      '  GET) cat "$file" ;;',
      '  POST) while (($#)); do [[ $1 == -f ]] && printf \'%s\\n\' "${2#labels[]=}" >>"$file"; shift; done ;;',
      '  DELETE) grep -vxF "${path##*/}" "$file" >"$file.left"; mv "$file.left" "$file" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  return {
    calls: () => linesIn(calls),
    labels: (number: string) => (existsSync(held(number)) ? readFileSync(held(number), "utf8").split("\n").filter(Boolean).sort() : []),
    made: () => readFileSync(join(root, "repo"), "utf8").split("\n").filter(Boolean),
    run: (...args: string[]) => execute(join(BIN, "mark"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args),
  };
}

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
