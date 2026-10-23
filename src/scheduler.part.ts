import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_CAP } from "./brief.ts";
import { BIN, cloned, execute, git, key, plant, scratch, script, wellFormedSpec } from "./scenarios.ts";
import { type Progress, resumedAfterStop, tipMoved } from "./scheduler.ts";
import type { Slice } from "./slicer.ts";
import { MACHINE } from "./spelled.ts";
import { declareStage, HANDED_ON } from "./stages.ts";

export const SPEC_ISSUE = "968";
export const LANDED = "1600";

export interface Attempt {
  outcome?: "built" | "partial" | "stuck";
  wait?: number;
  then?: string;
}

export interface Finish {
  landed?: string;
  missed?: string;
  status?: number;
  then?: string;
}

export interface Comment {
  id: number;
  html_url: string;
  user: { login: string; type: string };
  body: string;
}

export const sliceOf = (id: string, blockedBy: string[] = []): Slice => ({ id, title: `Build ${id}`, why: `The spec asks for "${id}".`, done: [`${id} holds.`], blockedBy });

export const PAUSES = "printf 'paused\\n' >>\"$ROOT/labels\"";

export const MAIN_MOVES = 'sha=$(git commit-tree -p origin/main -m "Main moved" "$(git rev-parse "origin/main^{tree}")") && git push --quiet origin "$sha:refs/heads/main"';

const commentUrl = (id: number) => `https://github.com/collod873/claude-workflow/issues/${SPEC_ISSUE}#issuecomment-${id}`;

export const machineComment = (id: number, body: string): Comment => ({ id, html_url: commentUrl(id), user: { login: MACHINE, type: "Bot" }, body });

const GH = (root: string) => `#!/usr/bin/env node
const fs = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const root = ${JSON.stringify(root)};
const args = process.argv.slice(2);
const all = args.join(" ");
fs.appendFileSync(join(root, "gh-calls"), JSON.stringify(args) + "\\n");
const read = (name) => fs.readFileSync(join(root, name), "utf8");
const said = (text) => process.stdout.write(text + "\\n");
const comments = () => JSON.parse(read("comments.json"));
const saved = (held) => fs.writeFileSync(join(root, "comments.json"), JSON.stringify(held));
const labels = () => read("labels").split("\\n").filter(Boolean);
if (all.includes("repos/{owner}/{repo}/installation")) said("4242");
else if (all.includes("access_tokens")) { const n = Number(fs.existsSync(join(root, "minted")) ? read("minted") : "0") + 1; fs.writeFileSync(join(root, "minted"), String(n)); said("minted-" + n); }
else if (args[0] === "issue" && args[1] === "view") said(args.includes("--jq") ? labels().join("\\n") : JSON.stringify({ title: "A spec worth building", body: read("body"), labels: labels().map((name) => ({ name })) }));
else if (args[0] === "api" && args.includes("--paginate") && all.includes("/comments")) process.stdout.write(execFileSync("jq", ["-c", args[args.indexOf("--jq") + 1]], { input: JSON.stringify(comments()) }));
else if (args[0] === "issue" && args[1] === "comment") { const held = comments(); const id = held.length + 1; const url = "https://github.com/collod873/claude-workflow/issues/" + args[2] + "#issuecomment-" + id; held.push({ id, html_url: url, user: { login: ${JSON.stringify(MACHINE)}, type: "Bot" }, body: args[args.indexOf("--body") + 1] }); saved(held); said(url); }
else if (args.includes("PATCH")) { const id = Number(/comments\\/(\\d+)/.exec(all)[1]); const held = comments(); const found = held.find((comment) => comment.id === id); found.body = args[args.indexOf("-f") + 1].replace(/^body=/, ""); saved(held); said("{}"); }
`;

export function specIssue(root: string, { body = wellFormedSpec, labels = ["spec"], comments = [] as Comment[], gh = "" } = {}) {
  const at = (name: string) => join(root, name);
  plant(root, "body", body);
  plant(root, "labels", labels.map((label) => `${label}\n`).join(""));
  plant(root, "comments.json", JSON.stringify(comments));
  writeFileSync(at("gh"), GH(root));
  script(join(root, "bin", "gh"), `${gh}\nexec node "${at("gh")}" "$@"\n`);
  const saidOn = () => JSON.parse(readFileSync(at("comments.json"), "utf8")) as Comment[];
  return {
    calls: () => (existsSync(at("gh-calls")) ? readFileSync(at("gh-calls"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line) as string[]) : []),
    comments: saidOn,
    progress: () => {
      const json = /<!-- progress: (.*) -->/s.exec(saidOn().filter(({ body }) => body.startsWith("## Spec run")).at(-1)?.body ?? "")?.[1];
      return json === undefined ? undefined : (JSON.parse(json) as Progress);
    },
  };
}

const ORDER = (root: string) => `printf '%s\\n' "$*" >>"${join(root, "order")}"`;

export function scheduling({
  cuts = [] as (Slice[] | "red")[],
  plans = {} as Record<string, Attempt[]>,
  finishes = [] as Finish[],
  labels = ["spec"],
  comments = [] as Comment[],
  onSpec = [] as string[],
  appKeyed = false,
}: { cuts?: (Slice[] | "red")[]; plans?: Record<string, Attempt[]>; finishes?: Finish[]; labels?: string[]; comments?: Comment[]; onSpec?: string[]; appKeyed?: boolean } = {}) {
  const root = scratch("schedule-");
  const { remote, session } = cloned(root, "Start");
  if (onSpec.length > 0) {
    git(session, "checkout", "--quiet", "-b", `spec/${SPEC_ISSUE}`);
    for (const message of onSpec) git(session, "commit", "--quiet", "--allow-empty", "-m", message);
    git(session, "push", "--quiet", "origin", `spec/${SPEC_ISSUE}`);
    git(session, "checkout", "--quiet", "main");
    git(session, "branch", "--quiet", "-D", `spec/${SPEC_ISSUE}`);
  }
  const at = (name: string) => join(root, name);
  const issue = specIssue(root, { labels, comments });
  cuts.forEach((cut, n) => plant(root, `cuts/${n + 1}`, cut === "red" ? "red" : `${JSON.stringify({ slices: cut })}\n`));
  for (const [id, attempts] of Object.entries(plans)) attempts.forEach((attempt, n) => plant(root, `plans/${id}/${n + 1}`, JSON.stringify(attempt)));
  finishes.forEach((finish, n) => plant(root, `finishes/${n + 1}`, JSON.stringify(finish)));
  script(join(root, "bin", "mark"), `${ORDER(root).replace('"$*"', '"mark $*"')}\n`);
  script(
    join(root, "bin", "slice"),
    [
      `n=$(( $(ls "${at("sliced")}" 2>/dev/null | wc -l) + 1 ))`,
      `mkdir -p "${at("sliced")}"`,
      `{ printf 'token=%s\\n' "\${GH_TOKEN:-}"; printf 'past-main=%s\\n' "$(git rev-list --count origin/main..HEAD)"; git log --format=%s; } >"${at("sliced")}/$n"`,
      ORDER(root).replace('"$*"', '"slice $*"'),
      `cut="${at("cuts")}/$n"`,
      '[[ -f $cut ]] || { printf \'{"slices":[]}\\n\'; exit 0; }',
      '[[ $(cat "$cut") == red ]] && { printf \'slice: #968 ended red\\n\' >&2; exit 1; }',
      'cat "$cut"',
      "",
    ].join("\n"),
  );
  script(
    join(root, "bin", "build-slice"),
    [
      `ROOT="${root}"; id=""; onto=""`,
      'argv=("$@")',
      "while (($#)); do case $1 in --slice) id=$2; shift 2 ;; --onto) onto=$2; shift 2 ;; *) shift ;; esac; done",
      `mkdir -p "${at("built")}" "${at("running")}"`,
      `k=$(( $(ls "${at("built")}" | grep -c "^$id-[0-9]*$") + 1 ))`,
      `{ printf 'token=%s\\n' "\${GH_TOKEN:-}"; printf 'key=%s\\n' "$(jq -r .clientId "\${APP_KEY_FILE:-/dev/null}" 2>/dev/null)"; printf 'dir=%s\\n' "$PWD"; printf 'branch=%s\\n' "$(git rev-parse --abbrev-ref HEAD)"; git log --format=%s; } >"${at("built")}/$id-$k.seen"`,
      '[[ -n ${APP_KEY_FILE:-} ]] && rm -f "$APP_KEY_FILE"',
      `printf '%s\\0' "\${argv[@]}" >"${at("built")}/$id-$k"`,
      `mkdir "${at("running")}/$id"; ls "${at("running")}" | wc -l >>"${at("peaks")}"`,
      ORDER(root).replace('"$*"', '"build $id start"'),
      `plan="${at("plans")}/$id/$k"`,
      "[[ -f $plan ]] && attempt=$(cat \"$plan\") || attempt='{}'",
      "outcome=$(jq -r '.outcome // \"built\"' <<<\"$attempt\"); wait=$(jq -r '.wait // 0' <<<\"$attempt\"); then=$(jq -r '.then // \"\"' <<<\"$attempt\")",
      'if [[ $outcome != stuck ]]; then git rebase --quiet "$onto" && printf \'%s\\n\' "$id" >"$id-$k.txt" && git add "$id-$k.txt" && git commit --quiet -m "Build $id" -m "Slice: $id"; fi',
      'sleep "$wait"',
      'eval "$then"',
      `rmdir "${at("running")}/$id"`,
      ORDER(root).replace('"$*"', '"build $id $outcome"'),
      "case $outcome in",
      '  built) printf \'{"outcome":"built","left":"","reason":"","session":"session-%s-%s"}\\n\' "$id" "$k" ;;',
      '  partial) printf \'{"outcome":"partial","left":"the rest of %s","reason":"","session":"session-%s-%s"}\\n\' "$id" "$id" "$k" ;;',
      '  stuck) printf \'{"outcome":"stuck","left":"","reason":"%s hit a wall","session":"session-%s-%s"}\\n\' "$id" "$id" "$k"; exit 1 ;;',
      "esac",
      "",
    ].join("\n"),
  );
  script(
    join(root, "bin", "finish"),
    [
      `n=$(( $(ls "${at("finished")}" 2>/dev/null | wc -l) + 1 ))`,
      `mkdir -p "${at("finished")}"`,
      `{ printf 'token=%s\\n' "\${GH_TOKEN:-}"; printf 'key=%s\\n' "$(jq -r .clientId "\${APP_KEY_FILE:-/dev/null}" 2>/dev/null)"; printf 'branch=%s\\n' "$(git rev-parse --abbrev-ref HEAD)"; git log --format=%s; } >"${at("finished")}/$n"`,
      ORDER(root).replace('"$*"', '"finish $*"'),
      `f="${at("finishes")}/$n"`,
      `ROOT="${root}"; [[ -f $f ]] && finish=$(cat "$f") || finish='{}'`,
      "eval \"$(jq -r '.then // \"\"' <<<\"$finish\")\"",
      `landed=$(jq -r '.landed // "${LANDED}"' <<<"$finish"); missed=$(jq -r '.missed // ""' <<<"$finish"); status=$(jq -r '.status // 0' <<<"$finish")`,
      '[[ $status == 0 ]] && git fetch --quiet origin main && git push --quiet origin "$(git commit-tree -p origin/main -p HEAD -m "Merge the spec" "HEAD^{tree}"):refs/heads/main"',
      "printf 'landed=%s\\nmissed=%s\\n' \"$landed\" \"$missed\"",
      'exit "$status"',
      "",
    ].join("\n"),
  );
  const keyFile = at("app-key.json");
  if (appKeyed) writeFileSync(keyFile, JSON.stringify({ clientId: "Iv23liSpecRun", key: key() }));
  const lines = (name: string) => (existsSync(at(name)) ? readFileSync(at(name), "utf8").trimEnd().split("\n") : []);
  const numbered = (dir: string) => (existsSync(at(dir)) ? readdirSync(at(dir)).map((_, n) => readFileSync(join(at(dir), String(n + 1)), "utf8")) : []);
  return {
    root,
    remote,
    session,
    order: () => lines("order"),
    peaks: () => lines("peaks").map(Number),
    sliced: () => numbered("sliced"),
    finished: () => numbered("finished"),
    built: (id: string, attempt = 1) => (existsSync(join(at("built"), `${id}-${attempt}`)) ? readFileSync(join(at("built"), `${id}-${attempt}`), "utf8").split("\0").filter((arg) => arg !== "") : undefined),
    seen: (id: string, attempt = 1) => readFileSync(join(at("built"), `${id}-${attempt}.seen`), "utf8"),
    ...issue,
    onRemote: (ref: string) => git(remote, "log", "--format=%s", ref).split("\n"),
    run: () =>
      execute(join(BIN, "schedule"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, MACHINE_BIN: join(root, "bin"), GH_TOKEN: "original", ...(appKeyed ? { APP_KEY_FILE: keyFile } : {}) }, [SPEC_ISSUE]),
  };
}

declareStage({
  part: { name: "bin/schedule", file: "bin/schedule", stops: "https://github.com/collod873/claude-workflow/issues/1509" },
  prompts: [
    {
      name: "slice builder told the tip moved",
      file: "src/scheduler.ts",
      cap: HANDED_ON,
      slots: [],
      build: () => tipMoved(SPEC_ISSUE),
    },
    {
      name: "slice builder resumed after a stop",
      file: "src/scheduler.ts",
      cap: LIST_CAP + HANDED_ON,
      slots: ["reason"],
      build: (filled) => resumedAfterStop(SPEC_ISSUE, filled.reason ?? ""),
    },
  ],
  scenarios: [
    { label: "building a spec's slices and landing it", run: () => scheduling({ cuts: [[sliceOf("seam")], []] }).run() },
    { label: "refusing a ticket", run: () => scheduling({ labels: ["ticket"] }).run() },
    { label: "calling the owner when no slice can move", run: () => scheduling({ cuts: [[sliceOf("seam")], []], plans: { seam: [{ outcome: "stuck" }, { outcome: "stuck" }] } }).run() },
  ],
});
