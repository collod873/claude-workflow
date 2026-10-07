import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, ghArgv, scratch, script, stubbedMark } from "./scenarios.ts";
import { OWNER_CALL } from "./spelled.ts";
import { declareStage } from "./stages.ts";

export const RUN_URL = "https://github.com/collod873/claude-workflow/actions/runs/4417";
export const OUT_OF_TIME = "The job has exceeded the maximum execution time of 1h0m0s";
export const CANCELLED_BY_OWNER = "The run was canceled by @collod873.";

interface Annotation {
  title?: string;
  message: string;
}

interface Ended {
  conclusion: string;
  annotations: Annotation[];
}

export const ownerCall = (issue: string, run: string): Annotation => ({ title: OWNER_CALL, message: `${issue} ${run}` });

export const red = (...annotations: Annotation[]): Ended => ({ conclusion: "failure", annotations: [ownerCall("902", "the slice run"), ...annotations] });

export function rerunning({ attempt = "1", jobs = [red()], labels = ["spec"], refused = "", markRefused = undefined as string | undefined, blip = "", pending = 0, latest = undefined as string | undefined, dispatchRefused = "", calledFrom = "" } = {}) {
  const root = scratch("rerun-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  writeFileSync(join(root, "jobs.json"), JSON.stringify({ jobs: [{ id: 1, name: "labelled", conclusion: "success" }, ...jobs.map(({ conclusion }, at) => ({ id: at + 10, name: "slice", conclusion }))] }));
  for (const [at, { annotations }] of jobs.entries()) writeFileSync(join(root, `annotations-${at + 10}.json`), JSON.stringify(annotations.map((one) => ({ title: one.title ?? "", message: one.message, annotation_level: "notice" }))));
  writeFileSync(join(root, "annotations-1.json"), "[]");
  const marks = stubbedMark(root, undefined, markRefused);
  script(
    join(root, "bin", "gh"),
    [
      setup,
      'case "$*" in',
      `  *"workflow run"*) ${dispatchRefused === "" ? "exit 0" : `printf '%s\\n' '${dispatchRefused}' >&2; exit 1`} ;;`,
      `  *"/attempts/${attempt}/jobs"*) ${blip === "" ? "" : `[[ -e "${join(root, "blipped")}" ]] || { touch "${join(root, "blipped")}"; printf '%s\\n' '${blip}' >&2; exit 1; }; `}cat "${join(root, "jobs.json")}" ;;`,
      `  *"/check-runs/"*) all="$*"; job=\${all##*/check-runs/}; cat "${root}/annotations-\${job%%/*}.json" ;;`,
      `  *"rerun-failed-jobs"*) ${refused === "" ? "exit 0" : `printf '%s\\n' '${refused}' >&2; exit 1`} ;;`,
      `  *"actions/runs/4417/attempts/${attempt} "*) polled=$(cat "${join(root, "polled")}" 2>/dev/null || echo 0); echo $((polled + 1)) >"${join(root, "polled")}"; ((polled < ${pending})) && echo in_progress || echo completed ;;`,
      `  *"actions/runs/4417 "*) printf '%s %s\\n' '${latest ?? attempt}' '${RUN_URL}' ;;`,
      `  *"issue view"*) printf '%s\\n' ${labels.map((label) => `'${label}'`).join(" ")} ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  const env = { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_REPO: "collod873/claude-workflow", RERUN_WAIT_SECONDS: "0", CALLED_FROM: calledFrom, TICKET: "902" };
  return { calls, marks, run: () => execute(join(BIN, "rerun"), root, env, ["4417", attempt]), dispatch: () => execute(join(BIN, "rerun"), root, env, ["--dispatch", "4417", attempt]) };
}

declareStage({
  part: { name: "bin/rerun", file: "bin/rerun", stops: "https://github.com/collod873/claude-workflow/issues/1178" },
  scenarios: [
    { label: "re-running a first red attempt", run: () => rerunning().run() },
    { label: "calling the owner on a second red attempt", run: () => rerunning({ attempt: "2" }).run() },
    { label: "with the re-run refused", run: () => rerunning({ refused: "HTTP 403: Resource not accessible by integration" }).run() },
    { label: "handing a red run to the caller file", run: () => rerunning().dispatch() },
  ],
});
