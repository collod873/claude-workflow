#!/usr/bin/env python3
"""Shared `gh` resolution, imported as a sibling by every `bin/` tool and by
`hooks/close-gate.py` reaching down into `bin/` (#102).

Before this module existed, three call sites each carried their own copy of "find `gh`,
then build its argv": `close-gate.py`'s `resolve_gh()` (ADR-0005's env-override-then-
`~/.local/bin`-first order, chosen because a login shell and a hook's bare PATH can
disagree about which `gh` is newest — the `2.46`/`2.96` skew ADR-0005 measured), and
`file-issue`/`publish-issue-graph`'s own `resolve_gh()`/`os.environ.get(...) or "gh"`,
each restating `if repo: args += ["-R", repo]` at every call site that needed one
(six of them, in `file-issue` alone).

`gh_bin()` is the one resolver every caller now shares — `AGENT_SKILLS_GH` generalises
ADR-0005's `CLOSE_GATE_GH` (the rule doesn't change, only the name: nothing about the
skew this guards against is specific to the close gate).

`bind_gh()` is the one place `-R <repo>` gets appended, so a caller passes `repo` once
when it builds its `gh(*args)` rather than at every call.

`run_gh()` / `GhError` (#109) are the one failure envelope over a bound `gh`: the
`try`/`TimeoutExpired`/`returncode` skeleton and the two message strings live here once.
What a failure *means* still stays local to each caller — close-gate's degraded-deny (it
calls its bound `gh` directly and maps each failure to a reason), `file-issue`'s exit,
`publish-issue-graph`'s raise are three different failure behaviours, deliberately not
unified here; only the string and the skeleton are shared.
"""
import os
import shutil
import subprocess

# The default deadline `bind_gh()` applies when a caller names none — the bin/ tools'
# shared 30s; close-gate passes its own ADR-0005 5s explicitly.
DEFAULT_GH_TIMEOUT_SECONDS = 30


class GhError(RuntimeError):
    """A `gh` call timed out or exited nonzero; `str(e)` is the one message format."""

# ADR-0005's order: the override, then a fixed list favoring `~/.local/bin` (where a
# login shell finds a newer `gh` than a hook's bare PATH does), then whatever a plain
# PATH search turns up — the permissive fallback `file-issue`/`publish-issue-graph`
# already relied on via `shutil.which`.
GH_SEARCH_DIRS = ("~/.local/bin", "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin")


def gh_bin() -> str | None:
    """Resolve the `gh` binary, or None when nothing resolves.

    An `AGENT_SKILLS_GH` override that isn't an executable file is not a signal to keep
    looking — it's treated as unresolved, so a broken override reads as "gh not found"
    rather than silently falling through to a different `gh` than the one asked for.
    """
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
    """Return a `gh(*args, **kwargs)` bound to `gh_path`, appending `-R <repo>` to every
    call when `repo` is given, and defaulting `timeout` (a caller can still override it
    per call). Returns the `subprocess.CompletedProcess` — checking `returncode` and
    turning a failure into an exit, a deny, or a raise is each caller's own job."""
    def gh(*args, **kwargs):
        argv = [gh_path, *args]
        if repo:
            argv += ["-R", repo]
        kwargs.setdefault("timeout", timeout)
        return subprocess.run(argv, **kwargs)
    gh.timeout = timeout
    return gh


def run_gh(gh, *args, **kwargs) -> str:
    """Run a bound `gh(*args)` for its stdout, raising `GhError` on a timeout or a nonzero
    exit with the one message format. `capture_output`/`text` are set here; other kwargs
    (`input`, `cwd`) pass through."""
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
