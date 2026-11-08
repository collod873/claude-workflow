import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commentEdited, commentOnTicket, ghAs } from "./post.ts";
import { scratch, script } from "./scenarios.ts";

const COMMENT = "https://github.com/collod873/Mezzanine/issues/2529#issuecomment-6713525004";
const PROGRESS = `## Spec run\n\n${"| `slice` | A slice title | merged | 1 |  |\n".repeat(4000)}`;

function recordingGh() {
  const root = scratch("post-");
  const said = join(root, "said");
  script(join(root, "bin", "gh"), [`said='${said}'`, 'prev=""', 'for arg in "$@"; do', '  [[ $arg == body=@* ]] && cat "${arg#body=@}" >"$said"', '  [[ $prev == --body-file ]] && cat "$arg" >"$said"', "  prev=$arg", "done", "printf 'answered\\n'", ""].join("\n"));
  const gh = ghAs({ ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_RETRY_SECONDS: "0" });
  return { gh, said: () => readFileSync(said, "utf8") };
}

describe("a body past the kernel's 128 KiB argument limit still reaches GitHub (Mezzanine#2529)", () => {
  it("edits a spec run's progress comment whose body outgrew one argument", () => {
    const { gh, said } = recordingGh();

    expect(PROGRESS.length).toBeGreaterThan(131072);
    expect(commentEdited(COMMENT, PROGRESS, gh)).toEqual({ refusals: [], said: "answered" });
    expect(said()).toBe(PROGRESS);
  });

  it("comments a body past the limit on a ticket", () => {
    const { gh, said } = recordingGh();

    expect(commentOnTicket("2529", PROGRESS, gh)).toEqual({ refusals: [], said: "answered" });
    expect(said()).toBe(PROGRESS);
  });
});
