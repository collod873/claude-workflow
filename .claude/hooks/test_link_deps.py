#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS = Path(__file__).resolve().parent
REPO = next((c for c in (HOOKS.parent, HOOKS.parent.parent) if (c / "bin").is_dir()), HOOKS.parent)
LINK_DEPS = REPO / "bin" / "link-deps"

MODULES_YAML = {
    "hoistPattern": ["*"],
    "layoutVersion": 5,
    "nodeLinker": "isolated",
    "packageManager": "pnpm@11.7.0",
    "storeDir": "/home/someone/.local/share/pnpm/store/v11",
    "virtualStoreDir": ".pnpm",
}


def build_fixture(root: Path) -> tuple[Path, Path]:
    repo = root / "Some Project"
    worktree = root / "wt-736"
    nm = repo / "node_modules"

    pkg = nm / ".pnpm" / "react@19.2.8" / "node_modules" / "react"
    pkg.mkdir(parents=True)
    (pkg / "package.json").write_text(json.dumps({"name": "react", "version": "19.2.8"}))
    (pkg / "index.js").write_text("module.exports = 'react'\n")
    os.symlink(".pnpm/react@19.2.8/node_modules/react", nm / "react")

    scoped = nm / "@types" / "node"
    scoped.mkdir(parents=True)
    (scoped / "package.json").write_text(json.dumps({"name": "@types/node"}))

    (nm / ".modules.yaml").write_text(json.dumps(MODULES_YAML, indent=2))
    (nm / ".pnpm-workspace-state-v1.json").write_text(json.dumps({
        "lastValidatedTimestamp": 1,
        "projects": {str(repo): {"name": "some-project", "version": "0.1.0"}},
        "pnpmfiles": [str(repo / ".pnpmfile.cjs")],
        "settings": {"nodeLinker": "isolated"},
    }, indent=2))

    (nm / ".bin").mkdir()
    os.symlink("../.pnpm/react@19.2.8/node_modules/react/index.js", nm / ".bin" / "react-cli")

    for cache in (".vite", ".vite-temp", ".cache"):
        (nm / cache).mkdir()
        (nm / cache / "chunk.js").write_text("cached\n")

    worktree.mkdir()
    return repo, worktree


ROWLOG = _harness.RowLog("link-deps-log-")


def run_cli(worktree: Path, repo: Path):
    return subprocess.run(
        [sys.executable, str(LINK_DEPS), str(worktree), str(repo)],
        capture_output=True, text=True, env=ROWLOG.env(),
    )


def test_farm_shape():
    print("the farm: shared packages symlinked, manifests copied, caches absent")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        proc = run_cli(worktree, repo)
        check("exits 0", proc.returncode == 0, proc.stderr)

        nm = worktree / "node_modules"
        check("node_modules is a real directory, never a symlink at the tree",
              nm.is_dir() and not nm.is_symlink(),
              f"is_symlink={nm.is_symlink()}")
        check("the marker is written", (nm / ".drain-linked").is_file())

        check("a package is a symlink into the main checkout",
              (nm / "react").is_symlink()
              and Path(os.readlink(nm / "react")) == repo / "node_modules" / "react",
              os.readlink(nm / "react") if (nm / "react").is_symlink() else "not a symlink")
        check("a scoped directory is a symlink, not a copy",
              (nm / "@types").is_symlink())
        check("the virtual store is a symlink",
              (nm / ".pnpm").is_symlink())

        check(".modules.yaml is a real file, not a symlink",
              (nm / ".modules.yaml").is_file() and not (nm / ".modules.yaml").is_symlink())
        check(".pnpm-workspace-state-v1.json is copied too (prefix match)",
              (nm / ".pnpm-workspace-state-v1.json").is_file()
              and not (nm / ".pnpm-workspace-state-v1.json").is_symlink())

        check(".bin is a real directory of symlinks, not one symlink to the repo's",
              (nm / ".bin").is_dir() and not (nm / ".bin").is_symlink()
              and (nm / ".bin" / "react-cli").is_symlink())

        for cache in (".vite", ".vite-temp", ".cache"):
            check(f"{cache} is not linked, no shared working set",
                  not (nm / cache).exists() and not (nm / cache).is_symlink())


def test_manifest_is_private():
    print("#140 AC1: a worker rewriting its manifest cannot reach the main checkout's")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        main_manifest = repo / "node_modules" / ".modules.yaml"
        before = main_manifest.read_bytes()

        proc = run_cli(worktree, repo)
        check("exits 0", proc.returncode == 0, proc.stderr)

        wt_manifest = worktree / "node_modules" / ".modules.yaml"
        check("the copy is a distinct inode, never a hardlink",
              wt_manifest.stat().st_ino != main_manifest.stat().st_ino,
              f"{wt_manifest.stat().st_ino} vs {main_manifest.stat().st_ino}")

        rewritten = dict(MODULES_YAML, virtualStoreDir=str(worktree / "node_modules" / ".pnpm"))
        wt_manifest.write_text(json.dumps(rewritten, indent=2))
        with open(wt_manifest, "r+") as fh:
            fh.truncate(0)
            fh.write(json.dumps(rewritten, indent=2))

        after = main_manifest.read_bytes()
        check("the main checkout's .modules.yaml is byte-identical before and after",
              before == after,
              "the worker's rewrite reached the main checkout; #140 reproduced")
        check("the worktree's own copy did take the rewrite",
              json.loads(wt_manifest.read_text())["virtualStoreDir"] != ".pnpm")


def test_workspace_state_is_retargeted():
    print("retarget: the workspace state names the worktree, not the main checkout")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        proc = run_cli(worktree, repo)
        check("exits 0", proc.returncode == 0, proc.stderr)

        state = json.loads((worktree / "node_modules" / ".pnpm-workspace-state-v1.json").read_text())
        check("the project key is the worktree's path, not the repo's",
              list(state["projects"]) == [str(worktree)], list(state["projects"]))
        check("the project's own metadata survives the rekey",
              state["projects"][str(worktree)]["name"] == "some-project", state["projects"])
        check("paths in a list are retargeted too, not only dict keys",
              state["pnpmfiles"] == [str(worktree / ".pnpmfile.cjs")], state["pnpmfiles"])
        check("fields that name no path are left alone",
              state["settings"] == {"nodeLinker": "isolated"}
              and state["lastValidatedTimestamp"] == 1, state)

        check("the main checkout's copy still names the main checkout",
              str(repo) in (repo / "node_modules" / ".pnpm-workspace-state-v1.json").read_text())

        wt_modules = json.loads((worktree / "node_modules" / ".modules.yaml").read_text())
        check(".modules.yaml is copied verbatim", wt_modules == MODULES_YAML, wt_modules)


def test_unparseable_manifest_is_copied_verbatim():
    print("degradation: a manifest that will not parse is copied, never dropped")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        garbage = "not json at all\x00"
        (repo / "node_modules" / ".pnpm-workspace-state-v1.json").write_text(garbage)

        proc = run_cli(worktree, repo)
        check("exits 0", proc.returncode == 0, proc.stderr)
        check("the manifest is present and verbatim",
              (worktree / "node_modules" / ".pnpm-workspace-state-v1.json").read_text() == garbage)


def test_packages_resolve_through_the_farm():
    print("resolution: a symlinked package still reaches its files in the virtual store")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        run_cli(worktree, repo)
        nm = worktree / "node_modules"

        meta = json.loads((nm / "react" / "package.json").read_text())
        check("react/package.json is readable through the farm", meta["name"] == "react", meta)
        check("the scoped package is readable too",
              (nm / "@types" / "node" / "package.json").is_file())
        check(".bin shim resolves to the package's entrypoint",
              (nm / ".bin" / "react-cli").resolve().is_file())


def test_replaces_the_forbidden_symlink():
    print("repair: the whole-tree symlink workers reached for is replaced in place")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        os.symlink(repo / "node_modules", worktree / "node_modules")
        check("fixture starts in the forbidden shape",
              (worktree / "node_modules").is_symlink())

        proc = run_cli(worktree, repo)
        check("exits 0", proc.returncode == 0, proc.stderr)
        check("the tree-level symlink is gone",
              not (worktree / "node_modules").is_symlink())
        check("a farm stands in its place",
              (worktree / "node_modules" / ".drain-linked").is_file())


def test_rebuild_is_idempotent():
    print("idempotence: re-running over our own farm rebuilds it, same shape")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        run_cli(worktree, repo)
        first = sorted(os.listdir(worktree / "node_modules"))
        proc = run_cli(worktree, repo)
        check("second run exits 0", proc.returncode == 0, proc.stderr)
        check("same entries after a rebuild",
              sorted(os.listdir(worktree / "node_modules")) == first)


def test_refuses_a_real_install():
    print("safety: an existing dependency tree we did not create is never deleted")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        real = worktree / "node_modules" / "somebody-elses-package"
        real.mkdir(parents=True)
        (real / "package.json").write_text("{}")

        proc = run_cli(worktree, repo)
        check("exits 2", proc.returncode == 2, f"exit {proc.returncode}")
        check("says why", "refusing to delete" in proc.stderr, proc.stderr)
        check("the existing tree is untouched", (real / "package.json").is_file())


def test_repo_without_dependencies():
    print("no-op: a repo with no node_modules is not a failure")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        repo = root / "docs only"
        repo.mkdir()
        worktree = root / "wt-1"
        worktree.mkdir()

        proc = run_cli(worktree, repo)
        check("exits 0", proc.returncode == 0, proc.stderr)
        check("says nothing to link", "nothing to link" in proc.stdout, proc.stdout)
        check("creates no node_modules", not (worktree / "node_modules").exists())


def test_usage_errors():
    print("usage: missing paths and wrong arity are refused, not guessed at")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        proc = subprocess.run([sys.executable, str(LINK_DEPS)], capture_output=True, text=True)
        check("no arguments exits 2", proc.returncode == 2, f"exit {proc.returncode}")

        proc = run_cli(Path(td) / "no-such-worktree", repo)
        check("a missing worktree exits 2", proc.returncode == 2, f"exit {proc.returncode}")

        proc = run_cli(worktree, Path(td) / "no-such-repo")
        check("a missing repo exits 2", proc.returncode == 2, f"exit {proc.returncode}")


def test_inode_cost_is_bounded():
    print("cost: the farm is a per-top-level-entry cost, not a per-file one")
    with tempfile.TemporaryDirectory() as td:
        repo, worktree = build_fixture(Path(td))
        run_cli(worktree, repo)
        src_entries = sum(1 for _ in (repo / "node_modules").rglob("*"))
        dst_entries = sum(1 for _ in os.listdir(worktree / "node_modules"))
        check("the worktree's tree is far smaller than the checkout's",
              dst_entries < src_entries,
              f"{dst_entries} entries vs {src_entries} in the main checkout")


def test_run_row():
    print("one run row per invocation, with the entries it linked")
    with tempfile.TemporaryDirectory(prefix="link-deps-row-") as tmp_str:
        tmp = Path(tmp_str)
        repo, worktree = build_fixture(tmp)
        run_cli(worktree, repo)
        rows = ROWLOG.last("link-deps")
        check("a farm writes one row, verdict=linked, with a nonzero count",
              len(rows) == 1 and rows[0].get("verdict") == "linked"
              and rows[0].get("count", 0) > 0, str(rows))
        check("the row names the tool, not a hook",
              rows and rows[0].get("tool") == "link-deps", str(rows))

        bare_repo = tmp / "bare-repo"
        bare_repo.mkdir()
        bare_worktree = tmp / "bare-worktree"
        bare_worktree.mkdir()
        run_cli(bare_worktree, bare_repo)
        rows = ROWLOG.last("link-deps")
        check("a repo with no dependency tree writes verdict=nothing, not a failure",
              len(rows) == 1 and rows[0].get("verdict") == "nothing", str(rows))

        run_cli(tmp / "does-not-exist", repo)
        rows = ROWLOG.last("link-deps")
        check("a refusal writes one row, verdict=refused",
              len(rows) == 1 and rows[0].get("verdict") == "refused", str(rows))


def main():
    test_farm_shape()
    test_manifest_is_private()
    test_workspace_state_is_retargeted()
    test_unparseable_manifest_is_copied_verbatim()
    test_packages_resolve_through_the_farm()
    test_replaces_the_forbidden_symlink()
    test_rebuild_is_idempotent()
    test_refuses_a_real_install()
    test_repo_without_dependencies()
    test_usage_errors()
    test_inode_cost_is_bounded()
    test_run_row()
    ROWLOG.cleanup()
    finish("bin/link-deps: the farm isolates every mutable path (#140).")


if __name__ == "__main__":
    main()
