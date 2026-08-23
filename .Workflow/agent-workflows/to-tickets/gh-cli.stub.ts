import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What the stub `gh` binary should do for a call it recognizes. */
export interface GhStubOptions {
  /** The issue number `gh issue create` reports back, via its issue URL —
   * and the seed for the REST id the `--jq .id` lookup on that issue then
   * returns. Defaults to 200, clear of any number a test's fixture plan
   * would assign on its own. */
  issueNumber?: number;
  /** When set, every call this stub receives prints this to stderr and
   * exits nonzero instead of succeeding — models a rejected publish (e.g.
   * `issue create` failing) rather than a successful one. */
  fails?: string;
}

/**
 * A stub `gh` binary, for a test that drives `--stage audit-and-publish` as
 * a real subprocess end to end without reaching GitHub. Writes into the same
 * `dir/bin` subfolder `shared/claude-cli.stub.ts`'s `stubClaudeCli` writes
 * its `claude` stub into — so a caller that already holds `stubClaudeCli`'s
 * `env` needs no second `PATH` merge to pick this one up too. Call this
 * *after* `stubClaudeCli(dir, …)`, which is what creates that `bin`
 * subfolder in the first place.
 *
 * Models only the slice of `gh` this pipeline's publisher
 * (`shared/publish-sub-issues.ts`) actually shells out to for a
 * dependency-free plan: `issue create` (answered with an issue URL for
 * `issueNumber`), the `--jq .id` lookup on that issue, and the `sub_issues`
 * attach under the PRD — enough to carry a single dependency-free slice
 * through `sliceAndPublish` end to end. A plan with a `dependsOn` edge would
 * also need the `dependencies/blocked_by` wiring and read-back calls, which
 * this stub answers too (write: any call carrying `-f`; read: `[]`), but no
 * fixture used against it exercises that path today.
 */
export function stubGhCli(dir: string, options: GhStubOptions = {}): void {
  const stubDir = join(dir, "bin");
  mkdirSync(stubDir, { recursive: true });
  const stubPath = join(stubDir, "gh");

  const issueNumber = options.issueNumber ?? 200;
  // A REST numeric id, deliberately distinct in shape from the issue number
  // it belongs to — same convention `shared/gh.fake.ts` uses, so a test
  // asserting on one can't mistake it for the other.
  const issueId = issueNumber * 1000 + 7;

  const script = options.fails
    ? `#!/usr/bin/env bash\necho ${shellQuote(options.fails)} >&2\nexit 1\n`
    : `#!/usr/bin/env bash
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  echo "https://github.com/owner/repo/issues/${issueNumber}"
  exit 0
fi
if [ "$1" = "api" ]; then
  case "$2" in
    *sub_issues)
      exit 0
      ;;
    *dependencies/blocked_by)
      for arg in "$@"; do
        if [ "$arg" = "-f" ]; then
          exit 0
        fi
      done
      echo "[]"
      exit 0
      ;;
    *)
      echo "${issueId}"
      exit 0
      ;;
  esac
fi
echo "gh stub: unhandled argv: $*" >&2
exit 1
`;

  writeFileSync(stubPath, script, "utf8");
  chmodSync(stubPath, 0o755);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
