#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS_DIR = Path(__file__).resolve().parent
HOOK = HOOKS_DIR / "clone-refresh.py"

FAKE_NPM = (
    "#!/usr/bin/env python3\n"
    "import os, sys\n"
    "log = os.environ.get('NPM_CALL_LOG')\n"
    "if log:\n"
    "    with open(log, 'a') as f:\n"
    "        f.write(' '.join(sys.argv[1:]) + chr(10))\n"
    "sys.exit(0)\n"
)


def build_origin(tmp: Path, name: str = "origin") -> Path:
    origin = tmp / name
    origin.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(origin)], check=True)
    subprocess.run(["git", "-C", str(origin), "config", "user.email", "t@example.com"], check=True)
    subprocess.run(["git", "-C", str(origin), "config", "user.name", "Test"], check=True)
    (origin / ".gitignore").write_text("__pycache__/\n")
    hooks = origin / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    (hooks / "clone-refresh.py").write_text(HOOK.read_text())
    (hooks / "_hook.py").write_text((HOOKS_DIR / "_hook.py").read_text())
    binp = origin / "bin"
    binp.mkdir()
    linker = binp / "link-workstation"
    linker.write_text(
        "#!/usr/bin/env python3\n"
        "import os, sys\n"
        "log = os.environ.get('LINKER_CALL_LOG')\n"
        "if log:\n"
        "    with open(log, 'a') as f:\n"
        "        f.write(' '.join(sys.argv[1:]) + chr(10))\n"
    )
    linker.chmod(0o755)
    lib = origin / "lib" / "md-html"
    lib.mkdir(parents=True)
    (lib / "package.json").write_text('{"name": "md-html"}\n')
    (origin / "package.json").write_text(
        '{"name": "claude-workflow", "workspaces": ["lib/md-html"]}\n')
    (origin / "package-lock.json").write_text('{"lockfileVersion": 3, "rev": 1}\n')
    subprocess.run(["git", "-C", str(origin), "add", "."], check=True)
    subprocess.run(["git", "-C", str(origin), "commit", "-q", "-m", "init"], check=True)
    return origin


def clone_target(origin: Path, home: Path) -> Path:
    target = home / ".agents" / "workflow"
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "-q", str(origin), str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "config", "user.email", "t@example.com"], check=True)
    subprocess.run(["git", "-C", str(target), "config", "user.name", "Test"], check=True)
    return target


def run_hook(home: Path, npm_dir: Path | None = None, extra_env: dict | None = None,
            timeout: int = _harness.HOOK_TIMEOUT * 3):
    env = dict(os.environ)
    env["HOME"] = str(home)
    if npm_dir is not None:
        env["PATH"] = f"{npm_dir}{os.pathsep}{env.get('PATH', '')}"
    if extra_env:
        env.update(extra_env)
    hook = home / ".agents" / "workflow" / ".claude" / "hooks" / "clone-refresh.py"
    return subprocess.run([sys.executable, str(hook)], input=b"{}",
                          capture_output=True, env=env, timeout=timeout)


def make_npm_dir(tmp: Path) -> Path:
    npm_dir = tmp / "fake-npm-bin"
    npm_dir.mkdir()
    npm = npm_dir / "npm"
    npm.write_text(FAKE_NPM)
    npm.chmod(0o755)
    return npm_dir


def main() -> None:
    print("\n## Not the target clone: stands down silently")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home = tmp / "home-elsewhere"
        home.mkdir()
        run = _harness.run_hook(HOOK, b"{}", env={**os.environ, "HOME": str(home)})
        check("this repo's own checkout is not ~/.agents/workflow: exit 0",
              run.proc.returncode == 0, run.proc.stderr)
        check("this repo's own checkout: silent stdout", run.proc.stdout == b"", run.proc.stdout)
        check("this repo's own checkout: silent stderr", run.proc.stderr == b"", run.proc.stderr)

    print("\n## Happy path: fast-forwards and re-links, no npm ci when the lockfile is unchanged")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        origin = build_origin(tmp)
        home = tmp / "home"
        target = clone_target(origin, home)

        (origin / "docs.md").write_text("more docs\n")
        subprocess.run(["git", "-C", str(origin), "add", "."], check=True)
        subprocess.run(["git", "-C", str(origin), "commit", "-q", "-m", "second"], check=True)

        npm_dir = make_npm_dir(tmp)
        npm_log = tmp / "npm-calls.log"
        linker_log = tmp / "linker-calls.log"
        r = run_hook(home, npm_dir=npm_dir,
                    extra_env={"NPM_CALL_LOG": str(npm_log), "LINKER_CALL_LOG": str(linker_log)})
        check("happy path: exit 0", r.returncode == 0, r.stderr)
        check("happy path: no CLONE STALE notice", b"CLONE STALE" not in r.stdout, r.stdout)
        check("happy path: the fast-forward actually landed",
              (target / "docs.md").exists(), list(target.iterdir()))
        check("happy path: npm ci is not spent when the lockfile did not change",
              not npm_log.exists(), "")
        check("happy path: the linker ran with --apply",
              linker_log.exists() and linker_log.read_text().strip() == "--apply",
              linker_log.read_text() if linker_log.exists() else "<no file>")

    print("\n## Already up to date is still a refresh, not a stale notice")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        origin = build_origin(tmp)
        home = tmp / "home"
        clone_target(origin, home)
        r = run_hook(home)
        check("up to date: exit 0, no stale notice",
              r.returncode == 0 and b"CLONE STALE" not in r.stdout, r.stdout)

    print("\n## A changed lockfile spends the workspace install")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        origin = build_origin(tmp)
        home = tmp / "home"
        target = clone_target(origin, home)

        (origin / "package-lock.json").write_text('{"lockfileVersion": 3, "rev": 2}\n')
        subprocess.run(["git", "-C", str(origin), "add", "."], check=True)
        subprocess.run(["git", "-C", str(origin), "commit", "-q", "-m", "bump lock"], check=True)

        npm_dir = make_npm_dir(tmp)
        npm_log = tmp / "npm-calls.log"
        r = run_hook(home, npm_dir=npm_dir, extra_env={"NPM_CALL_LOG": str(npm_log)})
        check("lockfile changed: exit 0", r.returncode == 0, r.stderr)
        check("lockfile changed: npm ci --workspace lib/md-html --ignore-scripts ran",
              npm_log.exists()
              and npm_log.read_text().strip() == "ci --workspace lib/md-html --ignore-scripts",
              npm_log.read_text() if npm_log.exists() else "<no file>")

    print("\n## Not on main is announced and left alone")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        origin = build_origin(tmp)
        home = tmp / "home"
        target = clone_target(origin, home)
        subprocess.run(["git", "-C", str(target), "checkout", "-q", "-b", "other"], check=True)
        r = run_hook(home)
        check("not on main: exit 0", r.returncode == 0, r.stderr)
        check("not on main: names the reason",
              r.stdout.startswith(b"CLONE STALE: not on main"), r.stdout)

    print("\n## A dirty tree is announced and left alone")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        origin = build_origin(tmp)
        home = tmp / "home"
        target = clone_target(origin, home)
        (target / "package.json").write_text("{}\n")
        r = run_hook(home)
        check("dirty tree: exit 0", r.returncode == 0, r.stderr)
        check("dirty tree: names the reason",
              r.stdout.startswith(b"CLONE STALE: working tree has uncommitted changes"), r.stdout)

    print("\n## A diverged clone refuses the fast-forward and is announced")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        origin = build_origin(tmp)
        home = tmp / "home"
        target = clone_target(origin, home)

        (origin / "docs.md").write_text("origin moved on\n")
        subprocess.run(["git", "-C", str(origin), "add", "."], check=True)
        subprocess.run(["git", "-C", str(origin), "commit", "-q", "-m", "origin advances"], check=True)

        (target / "local.md").write_text("a local commit that should never exist here\n")
        subprocess.run(["git", "-C", str(target), "add", "."], check=True)
        subprocess.run(["git", "-C", str(target), "commit", "-q", "-m", "local drift"], check=True)

        r = run_hook(home)
        check("diverged: exit 0, never blocks a session", r.returncode == 0, r.stderr)
        check("diverged: names the reason",
              r.stdout.startswith(b"CLONE STALE: git merge --ff-only failed"), r.stdout)

    print("\n## An unreachable origin is announced, not thrown")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        origin = build_origin(tmp)
        home = tmp / "home"
        target = clone_target(origin, home)
        subprocess.run(["git", "-C", str(target), "remote", "set-url", "origin",
                        str(tmp / "no-such-origin")], check=True)
        r = run_hook(home)
        check("unreachable origin: exit 0", r.returncode == 0, r.stderr)
        check("unreachable origin: names the reason",
              r.stdout.startswith(b"CLONE STALE: git fetch failed"), r.stdout)

    print("\n## A fetch that overruns its timeout is announced, not hung")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        origin = build_origin(tmp)
        home = tmp / "home"
        target = clone_target(origin, home)
        slow_git_dir = tmp / "slow-git-bin"
        slow_git_dir.mkdir()
        real_git = shutil.which("git")
        slow_git = slow_git_dir / "git"
        slow_git.write_text(
            "#!/bin/sh\n"
            "case \"$*\" in\n"
            "  *fetch*) sleep 5 ;;\n"
            "esac\n"
            f"exec {real_git} \"$@\"\n"
        )
        slow_git.chmod(0o755)
        r = run_hook(home, extra_env={
            "PATH": f"{slow_git_dir}{os.pathsep}{os.environ.get('PATH', '')}",
            "CLONE_REFRESH_FETCH_TIMEOUT": "1",
        })
        check("slow fetch: exit 0, never hangs the session", r.returncode == 0, r.stderr)
        check("slow fetch: names the timeout",
              r.stdout.startswith(b"CLONE STALE: git fetch exceeded its 1s timeout"), r.stdout)

    finish("All clone-refresh checks passed.")


if __name__ == "__main__":
    main()
