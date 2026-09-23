import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parts, type Part } from "./parts.ts";
import { FAILURE_LINK, refusedLinks } from "./part-links.ts";
import { scratch, script } from "./scenarios.ts";

const REPO = "https://github.com/collod873/claude-workflow";

function recordedGh(): { gh: string; calls: () => string[] } {
  const dir = scratch("part-links-");
  const log = join(dir, "calls");
  const api = "repos/collod873/claude-workflow";
  script(join(dir, "gh"), [
    `printf '%s\\n' "$*" >>${JSON.stringify(log)}`,
    "case $2 in",
    `  ${api}/issues/1) echo '{"number":1}' ;;`,
    `  ${api}/pulls/2) echo '{"number":2}' ;;`,
    `  ${api}/actions/runs/3) echo '{"status":"completed","conclusion":"failure"}' ;;`,
    `  ${api}/actions/runs/4) echo '{"status":"completed","conclusion":"success"}' ;;`,
    `  ${api}/actions/runs/5) echo '{"status":"in_progress","conclusion":null}' ;;`,
    `  ${api}/issues/7) echo 'gh: Bad credentials (HTTP 401)' >&2; exit 1 ;;`,
    "  *) echo '{\"message\":\"Not Found\",\"status\":\"404\"}'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;",
    "esac",
    "",
  ].join("\n"));
  return { gh: join(dir, "gh"), calls: () => readFileSync(log, "utf8").trim().split("\n") };
}

const part = (name: string, stops: string): Part => ({ name, file: `core/${name}`, stops });

describe("every part's failure link resolves on GitHub to an issue, a PR or a run that failed (#682)", () => {
  it("passes an issue, a PR and a failed run, and refuses a commit, a missing issue or PR, a run that did not fail, and a link it cannot check", async () => {
    const { gh, calls } = recordedGh();
    const registry = [
      part("issue", `${REPO}/issues/1`),
      part("pull", `${REPO}/pull/2`),
      part("failed", `${REPO}/actions/runs/3`),
      part("cleanup", `${REPO}/commit/c7fa969`),
      part("missing", `${REPO}/issues/404`),
      part("unopened", `${REPO}/pull/1`),
      part("passed", `${REPO}/actions/runs/4`),
      part("running", `${REPO}/actions/runs/5`),
      part("unreadable", `${REPO}/issues/7`),
      part("said", "the owner said so"),
    ];

    expect(await refusedLinks(registry, gh)).toEqual([
      `cleanup links a commit, which records a change and never a failure: ${REPO}/commit/c7fa969`,
      `missing links ${REPO}/issues/404, which does not exist`,
      `unopened links ${REPO}/pull/1, which does not exist`,
      `passed links ${REPO}/actions/runs/4, a run that did not fail (success)`,
      `running links ${REPO}/actions/runs/5, a run that did not fail (in_progress)`,
      `unreadable links ${REPO}/issues/7, which gh could not read: gh: Bad credentials (HTTP 401)`,
      "said links no issue, PR or run: the owner said so",
    ]);
    expect(calls().filter((call) => call.includes("commit"))).toEqual([]);
  });

  it("asks GitHub once per link, however many parts share it", async () => {
    const { gh, calls } = recordedGh();

    expect(await refusedLinks([part("one", `${REPO}/issues/1`), part("two", `${REPO}/issues/1`)], gh)).toEqual([]);
    expect(calls()).toEqual(["api repos/collod873/claude-workflow/issues/1"]);
  });
});
