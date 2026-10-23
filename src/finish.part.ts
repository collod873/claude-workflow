import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DIFF_CAP, LIST_CAP, TAIL_CAP } from "./brief.ts";
import { specWith } from "./done-checker.part.ts";
import { BRIEFS_CAP, onTheCode, onTheSpec, SLICE_CAP } from "./finish.ts";
import { FINDINGS_CAP } from "./slicer.ts";
import { authored, BIN, execute, ghArgv, git, key, plant, type Said, scratch, script } from "./scenarios.ts";
import { PAUSED } from "./spelled.ts";
import { declareStage, HANDED_ON } from "./stages.ts";
import { SPEC_CAP } from "./ticket-shape.ts";

const FINISHED_PR = "https://github.com/collod873/claude-workflow/pull/9974";
const POSTED = "https://github.com/collod873/claude-workflow/issues/974#issuecomment-1";
const FILED_NOTE = "https://github.com/collod873/claude-workflow/issues/975";

export interface Slice {
  id?: string;
  files: Record<string, string>;
  message?: string;
}

export function finishing({
  slices = [{ id: "tenant-time-zone", files: { "src/zone.ts": "export const zone = 1;\n" } }] as Slice[],
  labels = ["spec"] as string[],
  labelsAtLand = undefined as string[] | undefined,
  sentences = ["see the spec land on main"],
  tries = [{ sentence: 1, outcome: "held", tried: "saw it on main" }] as { sentence: number; outcome: string; tried: string }[],
  reviewer = "",
  answer = { outcome: "approve", reason: "reason $CALL" } as object,
  check = "printf 'check: ok\\n'\n",
  land = "",
  said = [] as Said[],
  appKeyed = false,
} = {}) {
  const root = scratch("finish-");
  const session = join(root, "session");
  const bin = join(root, "bin");
  const prompts = join(root, "prompts");
  const hires = join(root, "hires");
  const tokens = join(root, "tokens");
  const lands = join(root, "lands");
  const approvals = join(root, "approvals");
  const checks = join(root, "checks");
  const marks = join(root, "marks");
  const origin = join(root, "origin.git");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  git(root, "init", "--quiet", "--initial-branch=main", session);
  git(session, "config", "user.email", "builder@test");
  git(session, "config", "user.name", "builder");
  plant(session, "README.md", "what the spec stands on\n");
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "what the spec stands on");
  git(root, "init", "--quiet", "--bare", origin);
  git(session, "remote", "add", "origin", origin);
  git(session, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(session, "checkout", "--quiet", "-b", "spec/974");
  for (const { id, files, message } of slices) {
    for (const [path, text] of Object.entries(files)) plant(session, path, text);
    git(session, "add", ".");
    git(session, "commit", "--quiet", "-m", id === undefined ? "Build what no slice names" : `${message ?? `Build slice ${id}`}\n\nSlice: ${id}`);
  }
  plant(root, "issue.json", JSON.stringify({ title: "A spec worth finishing", body: specWith(sentences), labels: labels.map((name) => ({ name })) }));
  plant(root, "labels-at-land", (labelsAtLand ?? labels).map((label) => `${label}\n`).join(""));
  plant(root, "comments.json", authored(said));
  const answering = (output: object) => `${JSON.stringify({ type: "system", session_id: "review-$CALL" })}\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "review-$CALL", structured_output: output })}\n`;
  script(
    join(bin, "claude"),
    [
      `mkdir -p "${prompts}" "${hires}"`,
      `CALL=$(( $(ls "${prompts}" | wc -l) + 1 ))`,
      `printf '%s\\0' "$@" >"${hires}/$CALL"`,
      `cat >"${prompts}/$CALL"`,
      `if grep -q '^Try each sentence' "${prompts}/$CALL"; then`,
      `  cat <<'TRIES'\n${answering({ tries })}TRIES`,
      "else",
      reviewer,
      `  cat <<ANSWER\n${answering(answer)}ANSWER`,
      "fi",
      "",
    ].join("\n"),
  );
  script(
    join(bin, "gh"),
    [
      setup,
      `mkdir -p "${tokens}"`,
      `printf '%s' "\${GH_TOKEN:-}" >"${tokens}/$n"`,
      'case "$*" in',
      "  *\"repos/{owner}/{repo}/installation\"*) printf '4242\\n' ;;",
      "  *\"access_tokens\"*) printf 'minted-%s\\n' \"$n\" ;;",
      `  *"issue view"*"title,body,labels"*) cat "${join(root, "issue.json")}" ;;`,
      `  *"issue view"*"labels"*"--jq"*) cat "${join(root, "labels-at-land")}" ;;`,
      `  *"api"*"issues/974/comments"*) cat "${join(root, "comments.json")}" ;;`,
      `  *"issue comment"*) printf '%s\\n' '${POSTED}' ;;`,
      `  *"issue create"*) printf '%s\\n' '${FILED_NOTE}' ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  script(join(bin, "check"), `printf '%s\\n' "$*" >>"${checks}"\n${check}`);
  script(join(bin, "mark"), `printf '%s\\n' "$*" >>"${marks}"\n`);
  script(join(bin, "land"), `printf '%s %s %s\\n' "\${GH_TOKEN:-}" "$(git rev-parse HEAD)" "$1 $2" >>"${lands}"\nprintf '%s\\0' "$4" >>"${approvals}"\n${land}\nprintf 'Landed ${FINISHED_PR}\\n'\n`);
  const keyFile = join(root, "app-key.json");
  if (appKeyed) plant(root, "app-key.json", JSON.stringify({ clientId: "Iv1.finish", key: key() }));
  const listed = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : []);
  const numbered = (dir: string) => (existsSync(dir) ? readdirSync(dir).map((_, at) => readFileSync(join(dir, String(at + 1)), "utf8")) : []);
  return {
    session,
    handed: () => numbered(prompts),
    hired: () => numbered(hires).map((argv) => argv.split("\0").filter((part) => part !== "")),
    landed: () => listed(lands).map((line) => line.split(" ")),
    approved: () => (existsSync(approvals) ? readFileSync(approvals, "utf8").split("\0").filter((reason) => reason !== "") : []),
    checked: () => listed(checks),
    marked: () => listed(marks),
    calls,
    tokenOf: (made: (args: string[]) => boolean) => calls().flatMap((args, at) => (made(args) ? [readFileSync(join(tokens, String(at + 1)), "utf8")] : [])),
    log: (...args: string[]) => git(session, "log", ...args),
    pushed: () => git(origin, "log", "--format=%s", "spec/974"),
    run: (...args: string[]) =>
      execute(join(BIN, "finish"), session, { PATH: `${bin}:${process.env.PATH}`, MACHINE_BIN: bin, GH_TOKEN: "job-token", QUIET_GH_TOKEN: "job-token", ...(appKeyed ? { APP_KEY_FILE: keyFile } : {}) }, args.length === 0 ? ["974"] : args),
  };
}

const SLOTTED = ["slice", "commits", "diff", "stat"];
const changesOf = (filled: Record<string, string>) => ({ slice: filled.slice ?? "", commits: filled.commits ?? "", diff: filled.diff ?? "", stat: filled.stat ?? "" });

declareStage({
  part: { name: "bin/finish", file: "bin/finish", stops: "https://github.com/collod873/claude-workflow/issues/1509", lines: 3, printsData: true },
  prompts: [
    {
      name: "reviewer on the code standard",
      file: "src/finish.ts",
      cap: LIST_CAP + DIFF_CAP + TAIL_CAP + FINDINGS_CAP + 2 * SLICE_CAP + 2 * HANDED_ON,
      slots: [...SLOTTED, "red", "findings"],
      build: (filled) => onTheCode(changesOf(filled), { spec: "", red: filled.red ?? "", commitlint: true, findings: filled.findings ?? "" }),
    },
    {
      name: "reviewer on the spec",
      file: "src/finish.ts",
      cap: SPEC_CAP + LIST_CAP + DIFF_CAP + BRIEFS_CAP + FINDINGS_CAP + 2 * HANDED_ON,
      slots: ["commits", "diff", "stat", "title", "body", "briefs", "findings"],
      build: (filled) => onTheSpec(changesOf(filled), { spec: "", title: filled.title ?? "", body: filled.body ?? "", commitlint: true, briefs: filled.briefs ?? "", findings: filled.findings ?? "" }),
    },
  ],
  scenarios: [
    { label: "finishing a spec whose sentence held", run: () => finishing().run() },
    { label: "standing down on paused", run: () => finishing({ labels: ["spec", PAUSED] }).run() },
    { label: "refusing a ticket", run: () => finishing({ labels: ["ticket"] }).run() },
    { label: "refusing a call it does not take", run: () => finishing().run("974", "--now") },
  ],
});
