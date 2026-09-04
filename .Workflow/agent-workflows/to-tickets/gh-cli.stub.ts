import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @fixture Writes a `gh` onto a test's path; a lane on that path never talked to the tracker.
 */

export interface GhStubOptions {
  issueNumber?: number;
  fails?: string;
}

export function stubGhCli(dir: string, options: GhStubOptions = {}): void {
  const stubDir = join(dir, "bin");
  mkdirSync(stubDir, { recursive: true });
  const stubPath = join(stubDir, "gh");

  const issueNumber = options.issueNumber ?? 200;
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
        if [ "$arg" = "-F" ]; then
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
