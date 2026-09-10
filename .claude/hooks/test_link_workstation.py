#!/usr/bin/env python3
import json
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS = Path(__file__).resolve().parent
REPO = next((c for c in (HOOKS.parent, HOOKS.parent.parent) if (c / "bin").is_dir()), HOOKS.parent)
LINK_WORKSTATION = REPO / "bin" / "link-workstation"


def run(home: Path, *args: str):
    env = dict(os.environ)
    env["HOME"] = str(home)
    return subprocess.run([sys.executable, str(LINK_WORKSTATION), *args],
                          capture_output=True, text=True, env=env, timeout=_harness.HOOK_TIMEOUT * 3)


def make_home(tmp: Path, workstation: Path | None = REPO) -> Path:
    home = tmp / "home"
    (home / "bin").mkdir(parents=True)
    (home / ".claude" / "skills").mkdir(parents=True)
    (home / ".claude" / "hooks").mkdir(parents=True)
    if workstation is not None:
        agents_dir = home / ".agents"
        agents_dir.mkdir(parents=True)
        (agents_dir / "workflow").symlink_to(workstation, target_is_directory=True)
    return home


def main() -> None:
    print("\n## Refuses to run outside the workstation clone, before touching anything")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td), workstation=None)
        expected_clone = home / ".agents" / "workflow"
        settings_path = home / ".claude" / "settings.json"
        original_settings = json.dumps({"hooks": {}, "model": "sonnet"})
        settings_path.write_text(original_settings)

        for mode_args in (("--dry-run",), ("--apply",), ("--apply", "--settings")):
            r = run(home, *mode_args)
            check(f"{mode_args}: non-zero exit when REPO_ROOT is not the workstation clone",
                  r.returncode != 0, (r.stdout, r.stderr))
            check(f"{mode_args}: names this clone's own path", str(REPO) in r.stderr, r.stderr)
            check(f"{mode_args}: names the workstation clone's path",
                  str(expected_clone) in r.stderr, r.stderr)
            check(f"{mode_args}: names the fix", "run" in r.stderr.lower(), r.stderr)

        check("refused: nothing was linked", not (home / "bin" / "close-ticket").exists(), "")
        check("refused: settings.json is untouched",
              settings_path.read_text() == original_settings, settings_path.read_text())
        check("refused: no settings backup appears",
              not (home / ".claude" / "settings.json.pre-dispatch").exists(), "")

    print("\n## --dry-run reports without touching the filesystem")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        r = run(home, "--dry-run")
        check("dry-run: exit 0", r.returncode == 0, r.stderr)
        check("dry-run: proposes linking a real bin tool",
              "link " in r.stdout and "close-ticket" in r.stdout, r.stdout)
        check("dry-run: proposes linking a real skill",
              str(home / ".claude" / "skills" / "tdd") in r.stdout, r.stdout)
        check("dry-run: nothing was actually created",
              not (home / "bin" / "close-ticket").exists(), "")

    print("\n## --apply links bin tools and skills, and is idempotent")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)

        tool_link = home / "bin" / "close-ticket"
        check("apply: bin tool symlinked", tool_link.is_symlink(), "")
        check("apply: bin tool points at this repo's copy",
              tool_link.resolve() == (REPO / "bin" / "close-ticket").resolve(), "")

        module_link = home / "bin" / "gh_support.py"
        check("apply: a .py module in bin/ is never linked as a tool",
              not module_link.exists(), "")

        skill_link = home / ".claude" / "skills" / "tdd"
        check("apply: skill directory symlinked",
              skill_link.is_symlink()
              and skill_link.resolve() == (REPO / ".claude" / "skills" / "tdd").resolve(), "")

        r2 = run(home, "--apply")
        check("apply again: exit 0", r2.returncode == 0, r2.stderr)
        check("apply again: nothing to relink, so nothing is reported",
              "link " not in r2.stdout and "replace " not in r2.stdout, r2.stdout)

    print("\n## Never touches the personal kit: names this repo does not ship are never iterated")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        personal_target = Path(td) / "agents-skills-bin" / "gwsa"
        personal_target.parent.mkdir(parents=True)
        personal_target.write_text("#!/bin/sh\necho personal\n")
        (home / "bin" / "gwsa").symlink_to(personal_target)
        (home / ".claude" / "skills" / "audit-always-on").symlink_to(
            Path(td) / "agents-skills-skill-target")

        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)
        check("a personal-kit bin symlink is never named in the output",
              "gwsa" not in r.stdout, r.stdout)
        check("a personal-kit bin symlink still points exactly where it did",
              (home / "bin" / "gwsa").resolve() == personal_target.resolve(), "")
        check("a personal-kit skill symlink is never named in the output",
              "audit-always-on" not in r.stdout, r.stdout)

    print("\n## A name this repo ships is repointed even off an old agent-skills copy")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        old_agent_skills_bin = home / ".agents" / "skills" / "bin" / "close-ticket"
        old_agent_skills_bin.parent.mkdir(parents=True)
        old_agent_skills_bin.write_text("#!/bin/sh\necho the agent-skills copy\n")
        (home / "bin" / "close-ticket").symlink_to(old_agent_skills_bin)

        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)
        check("apply: the migration-era link is reported as replaced",
              "replace " in r.stdout and "close-ticket" in r.stdout, r.stdout)
        link = home / "bin" / "close-ticket"
        check("apply: a name this repo ships always ends up pointing at this repo's copy",
              link.resolve() == (REPO / "bin" / "close-ticket").resolve(), "")

    print("\n## A non-symlink file at the destination is left alone")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        real_file = home / "bin" / "close-ticket"
        real_file.write_text("#!/bin/sh\necho a real file, not a symlink\n")
        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)
        check("apply: the existing real file is reported as skipped",
              "skip " in r.stdout and "close-ticket" in r.stdout, r.stdout)
        check("apply: the existing real file is left untouched",
              not real_file.is_symlink()
              and real_file.read_text() == "#!/bin/sh\necho a real file, not a symlink\n", "")

    print("\n## Superseded ~/.claude/hooks symlinks into ~/.agents/skills/hooks are removed")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        agent_skills_hooks = home / ".agents" / "skills" / "hooks"
        agent_skills_hooks.mkdir(parents=True)
        old_hook = agent_skills_hooks / "close-gate.py"
        old_hook.write_text("# an old copy\n")
        (home / ".claude" / "hooks" / "close-gate.py").symlink_to(old_hook)

        elsewhere_target = Path(td) / "elsewhere.py"
        elsewhere_target.write_text("# unrelated\n")
        (home / ".claude" / "hooks" / "stop-gate.py").symlink_to(elsewhere_target)

        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)
        check("the agent-skills-pointed hook link is gone",
              not (home / ".claude" / "hooks" / "close-gate.py").exists(), "")
        check("a hook link pointing elsewhere is left exactly as it was",
              (home / ".claude" / "hooks" / "stop-gate.py").resolve() == elsewhere_target.resolve(), "")

    print("\n## --settings rewrites the hooks key and the env key")
    roster = json.loads((REPO / ".claude" / "hooks" / "roster.json").read_text())
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        original = {
            "hooks": {
                "PreToolUse": [{"matcher": "Bash", "hooks": [
                    {"type": "command", "command": "python3 ~/.claude/hooks/old-close-gate.py"}]}],
                "Notification": [{"hooks": [
                    {"type": "command", "command": "$HOME/bin/notify \"$1\" \"$2\""}]}],
            },
            "permissions": {"allow": ["Bash(git *)"]},
            "model": "sonnet",
            "env": {"EDITOR": "vim"},
        }
        settings_path = home / ".claude" / "settings.json"
        settings_path.write_text(json.dumps(original, indent=2))

        r = run(home, "--apply", "--settings")
        check("settings: exit 0", r.returncode == 0, r.stderr)

        rewritten = json.loads(settings_path.read_text())
        check("settings: one entry per roster event",
              set(rewritten["hooks"]) - {"Notification"} == set(roster), rewritten["hooks"].keys())
        for event in roster:
            commands = [h["command"] for group in rewritten["hooks"][event] for h in group["hooks"]]
            check(f"settings[{event}]: exactly one dispatcher command",
                  commands == [f"python3 {shlex.quote(str(REPO / '.claude' / 'hooks' / 'dispatch.py'))} {event}"],
                  commands)
        check("settings: Notification preserved verbatim",
              rewritten["hooks"]["Notification"] == original["hooks"]["Notification"], rewritten)
        check("settings: unrelated top-level keys preserved",
              rewritten["permissions"] == original["permissions"]
              and rewritten["model"] == original["model"], rewritten)
        check("settings: env.CLAUDE_WORKFLOW_ROOT names the clone root",
              rewritten["env"]["CLAUDE_WORKFLOW_ROOT"] == str(REPO), rewritten.get("env"))
        check("settings: a pre-existing env key is preserved beside it",
              rewritten["env"]["EDITOR"] == "vim", rewritten.get("env"))

        backup_path = home / ".claude" / "settings.json.pre-dispatch"
        check("settings: a backup of the pre-dispatch original was written",
              backup_path.is_file() and json.loads(backup_path.read_text()) == original, "")

        settings_path.write_text(json.dumps(rewritten, indent=2))
        r2 = run(home, "--apply", "--settings")
        check("settings again: exit 0", r2.returncode == 0, r2.stderr)
        check("settings again: the backup is never clobbered by a later run",
              json.loads(backup_path.read_text()) == original, "")

    print("\n## --settings without --apply changes nothing")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        original = {"hooks": {}, "model": "sonnet"}
        settings_path = home / ".claude" / "settings.json"
        settings_path.write_text(json.dumps(original))
        r = run(home, "--dry-run", "--settings")
        check("settings dry-run: exit 0", r.returncode == 0, r.stderr)
        check("settings dry-run: reports the rewrite", "rewrite" in r.stdout, r.stdout)
        check("settings dry-run: the file is untouched",
              json.loads(settings_path.read_text()) == original, "")
        check("settings dry-run: no backup file appears",
              not (home / ".claude" / "settings.json.pre-dispatch").exists(), "")

    print("\n## --settings quotes the dispatcher command when the clone root contains a space")
    with tempfile.TemporaryDirectory() as td:
        clone_root = Path(td) / "Claude Projects" / "Workflow"
        (clone_root / "bin").mkdir(parents=True)
        (clone_root / ".claude" / "hooks").mkdir(parents=True)
        clone_script = clone_root / "bin" / "link-workstation"
        clone_script.write_text(LINK_WORKSTATION.read_text())
        clone_script.chmod(0o755)
        (clone_root / ".claude" / "hooks" / "roster.json").write_text(
            (REPO / ".claude" / "hooks" / "roster.json").read_text())

        home = make_home(Path(td) / "home-with-space-clone", workstation=clone_root)
        settings_path = home / ".claude" / "settings.json"
        settings_path.write_text(json.dumps({"hooks": {}}))

        env = dict(os.environ)
        env["HOME"] = str(home)
        r = subprocess.run([sys.executable, str(clone_script), "--apply", "--settings"],
                            capture_output=True, text=True, env=env, timeout=_harness.HOOK_TIMEOUT * 3)
        check("space clone: exit 0", r.returncode == 0, r.stderr)

        rewritten = json.loads(settings_path.read_text())
        command = rewritten["hooks"]["PreToolUse"][0]["hooks"][0]["command"]

        stub_bin = Path(td) / "stub-bin"
        stub_bin.mkdir()
        stub_python = stub_bin / "python3"
        stub_python.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
        stub_python.chmod(0o755)
        shell_env = dict(os.environ)
        shell_env["PATH"] = f"{stub_bin}:{shell_env.get('PATH', '')}"
        shell_result = subprocess.run(["/bin/sh", "-c", command],
                                       capture_output=True, text=True, env=shell_env)
        words = [w for w in shell_result.stdout.split("\n") if w]
        check("space clone: command parses to exactly the dispatcher path and the event",
              words == [str(clone_root / ".claude" / "hooks" / "dispatch.py"), "PreToolUse"],
              (command, words, shell_result.stderr))

    print("\n## --settings against a malformed settings.json fails loudly, not silently")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        (home / ".claude" / "settings.json").write_text("{not json")
        r = run(home, "--apply", "--settings")
        check("malformed settings.json: non-zero exit", r.returncode != 0, r.returncode)
        check("malformed settings.json: names the problem", "not valid JSON" in r.stderr, r.stderr)

    finish("All link-workstation checks passed.")


if __name__ == "__main__":
    main()
