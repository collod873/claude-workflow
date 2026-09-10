import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function cloneRoot(): string {
  let dir = here;
  while (!existsSync(join(dir, "bin", "link-workstation"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`no clone root above ${here}`);
    dir = up;
  }
  return realpathSync(dir);
}

function homeWith(settings: unknown): string {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "link-workstation-"));
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  mkdirSync(join(home, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(settings, null, 2));
  return home;
}

test(
  "#417.1: link-workstation --settings --apply writes env.CLAUDE_WORKFLOW_ROOT equal to the clone root into ~/.claude/settings.json and leaves every other key untouched",
  () => {
    const root = cloneRoot();
    const original = {
      hooks: {
        Notification: [{ hooks: [{ type: "command", command: '$HOME/bin/notify "$1" "$2"' }] }],
      },
      permissions: { allow: ["Bash(git *)"] },
      model: "sonnet",
      env: { EDITOR: "vim" },
    };
    const home = homeWith(original);

    execFileSync("python3", [join(root, "bin", "link-workstation"), "--settings", "--apply"], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });

    const written = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));

    expect(written.env.CLAUDE_WORKFLOW_ROOT).toBe(root);
    expect(written.env.EDITOR).toBe("vim");
    expect(written.permissions).toEqual(original.permissions);
    expect(written.model).toBe(original.model);
    expect(written.hooks.Notification).toEqual(original.hooks.Notification);
  },
);
