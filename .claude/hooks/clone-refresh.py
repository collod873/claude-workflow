#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys
from pathlib import Path

import _hook

CLONE_ROOT = Path(__file__).resolve().parents[2]
TARGET_ROOT = Path.home() / ".agents" / "workflow"

FETCH_TIMEOUT_SECONDS = int(os.environ.get("CLONE_REFRESH_FETCH_TIMEOUT", "20"))
GIT_TIMEOUT_SECONDS = 10
NPM_TIMEOUT_SECONDS = 300
LINK_TIMEOUT_SECONDS = 30


def _git(root: Path, *args: str, timeout: int = GIT_TIMEOUT_SECONDS):
    git = shutil.which("git")
    if git is None:
        raise OSError("git not found on PATH")
    return subprocess.run([git, "-C", str(root), *args],
                          capture_output=True, text=True, timeout=timeout)


def _current_branch(root: Path) -> str | None:
    result = _git(root, "symbolic-ref", "--short", "HEAD")
    return result.stdout.strip() if result.returncode == 0 else None


def _dirty(root: Path) -> bool:
    result = _git(root, "status", "--porcelain")
    return result.returncode != 0 or bool(result.stdout.strip())


def _lockfile_blob(root: Path) -> str | None:
    result = _git(root, "rev-parse", "HEAD:package-lock.json")
    return result.stdout.strip() if result.returncode == 0 else None


def _run_best_effort(argv: list[str], root: Path, timeout: int) -> None:
    try:
        subprocess.run(argv, cwd=str(root), capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError):
        pass


def stale(reason: str) -> None:
    print(f"CLONE STALE: {reason}")


def refresh(root: Path) -> str:
    branch = _current_branch(root)
    if branch != "main":
        stale(f"not on main (on {branch or 'unknown'})")
        return "not-on-main"

    if _dirty(root):
        stale("working tree has uncommitted changes")
        return "dirty"

    before_lock = _lockfile_blob(root)

    try:
        fetch = _git(root, "fetch", "origin", "main", timeout=FETCH_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        stale(f"git fetch exceeded its {FETCH_TIMEOUT_SECONDS}s timeout")
        return "fetch-timeout"
    except OSError as exc:
        stale(f"git fetch could not run ({exc})")
        return "fetch-error"
    if fetch.returncode != 0:
        stale(f"git fetch failed: {(fetch.stderr or fetch.stdout).strip()[:300]}")
        return "fetch-failed"

    try:
        merge = _git(root, "merge", "--ff-only", "origin/main")
    except (subprocess.TimeoutExpired, OSError) as exc:
        stale(f"git merge --ff-only could not run ({exc})")
        return "merge-error"
    if merge.returncode != 0:
        stale(f"git merge --ff-only failed, probably diverged: "
              f"{(merge.stderr or merge.stdout).strip()[:300]}")
        return "diverged"

    after_lock = _lockfile_blob(root)
    if after_lock != before_lock:
        npm = shutil.which("npm")
        if npm is not None:
            _run_best_effort(
                [npm, "ci", "--workspace", "lib/md-html", "--ignore-scripts"],
                root, NPM_TIMEOUT_SECONDS)

    linker = root / "bin" / "link-workstation"
    if linker.is_file():
        _run_best_effort([sys.executable, str(linker), "--apply"], root, LINK_TIMEOUT_SECONDS)

    return "refreshed"


def main() -> None:
    data, _ok = _hook.read_payload()
    if CLONE_ROOT.resolve() != TARGET_ROOT.resolve():
        return
    verdict = refresh(CLONE_ROOT)
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(data, verdict))


if __name__ == "__main__":
    main()
