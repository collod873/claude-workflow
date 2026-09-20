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
    (home / ".claude" / "hooks").mkdir(parents=True)
    if workstation is not None:
        agents_dir = home / ".agents"
        agents_dir.mkdir(parents=True)
        (agents_dir / "workflow").symlink_to(workstation, target_is_directory=True)
    return home


def main() -> None:
    print("\n## --dry-run reports without touching the filesystem")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        r = run(home, "--dry-run")
        check("dry-run: exit 0", r.returncode == 0, r.stderr)
        check("dry-run: proposes linking a real bin tool",
              "link " in r.stdout and "hook-report" in r.stdout, r.stdout)
        check("dry-run: nothing was actually created",
              not (home / "bin" / "hook-report").exists(), "")

    print("\n## --apply links bin tools, and is idempotent")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)

        tool_link = home / "bin" / "hook-report"
        check("apply: bin tool symlinked", tool_link.is_symlink(), "")
        check("apply: bin tool points at this repo's copy",
              tool_link.resolve() == (REPO / "bin" / "hook-report").resolve(), "")

        module_link = home / "bin" / "gh_support.py"
        check("apply: a .py module in bin/ is never linked as a tool",
              not module_link.exists(), "")

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

        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)
        check("a personal-kit bin symlink is never named in the output",
              "gwsa" not in r.stdout, r.stdout)
        check("a personal-kit bin symlink still points exactly where it did",
              (home / "bin" / "gwsa").resolve() == personal_target.resolve(), "")

    print("\n## A name this repo ships is repointed even off an old agent-skills copy")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        old_agent_skills_bin = home / ".agents" / "skills" / "bin" / "hook-report"
        old_agent_skills_bin.parent.mkdir(parents=True)
        old_agent_skills_bin.write_text("#!/bin/sh\necho the agent-skills copy\n")
        (home / "bin" / "hook-report").symlink_to(old_agent_skills_bin)

        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)
        check("apply: the migration-era link is reported as replaced",
              "replace " in r.stdout and "hook-report" in r.stdout, r.stdout)
        link = home / "bin" / "hook-report"
        check("apply: a name this repo ships always ends up pointing at this repo's copy",
              link.resolve() == (REPO / "bin" / "hook-report").resolve(), "")

    print("\n## A non-symlink file at the destination is left alone")
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        real_file = home / "bin" / "hook-report"
        real_file.write_text("#!/bin/sh\necho a real file, not a symlink\n")
        r = run(home, "--apply")
        check("apply: exit 0", r.returncode == 0, r.stderr)
        check("apply: the existing real file is reported as skipped",
              "skip " in r.stdout and "hook-report" in r.stdout, r.stdout)
        check("apply: the existing real file is left untouched",
              not real_file.is_symlink()
              and real_file.read_text() == "#!/bin/sh\necho a real file, not a symlink\n", "")

    finish("All link-workstation checks passed.")


if __name__ == "__main__":
    main()
