#!/usr/bin/env python3
import os
import shutil
import subprocess

DEFAULT_GH_TIMEOUT_SECONDS = 30

class GhError(RuntimeError):
    pass

GH_SEARCH_DIRS = ("~/.local/bin", "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin")

def gh_bin() -> str | None:
    override = os.environ.get("AGENT_SKILLS_GH")
    if override:
        return override if os.path.isfile(override) and os.access(override, os.X_OK) else None
    for d in GH_SEARCH_DIRS:
        candidate = os.path.join(os.path.expanduser(d), "gh")
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return shutil.which("gh")

def bind_gh(gh_path: str, repo: str | None = None,
            timeout: float | None = DEFAULT_GH_TIMEOUT_SECONDS):
    def gh(*args, **kwargs):
        argv = [gh_path, *args]
        if repo:
            argv += ["-R", repo]
        kwargs.setdefault("timeout", timeout)
        return subprocess.run(argv, **kwargs)
    gh.timeout = timeout
    return gh

def run_gh(gh, *args, **kwargs) -> str:
    kwargs.setdefault("capture_output", True)
    kwargs.setdefault("text", True)
    head = " ".join(args[:2])
    try:
        result = gh(*args, **kwargs)
    except subprocess.TimeoutExpired:
        raise GhError(f"gh {head} timed out after {getattr(gh, 'timeout', None)}s")
    if result.returncode != 0:
        raise GhError(f"gh {head} failed: {result.stderr.strip()}")
    return result.stdout
