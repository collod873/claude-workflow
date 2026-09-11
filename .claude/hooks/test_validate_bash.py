#!/usr/bin/env python3
import json
import os
import shutil
import tempfile
from pathlib import Path

import _harness

HOOK = Path(__file__).with_name("validate-bash.py")

LOG_DIR = Path(tempfile.mkdtemp(prefix="validate-bash-log-"))
ENV = dict(os.environ, STOP_GATE_LOG_DIR=str(LOG_DIR))
SOLO = _harness.RowLog("validate-bash-guard-")

CASES = [
    ("block:dotenv-bare",            "cat .env",                                "BLOCK"),
    ("block:dotenv-head",            "head -1 .env",                            "BLOCK"),
    ("block:dotenv-with-path",       "cat /Users/me/project/.env",              "BLOCK"),
    ("block:dotenv-local",           "cat .env.local",                          "BLOCK"),
    ("block:dotenv-production",      "less .env.production",                    "BLOCK"),
    ("block:dotenv-backup",          "cat .env.backup",                         "BLOCK"),
    ("block:dotenv-tilde",           "cat ~/.env",                              "BLOCK"),
    ("block:dotenv-homevar",         "cat $HOME/.env",                          "BLOCK"),
    ("block:dotenv-subshell",        "echo $(cat .env)",                        "BLOCK"),
    ("block:dotenv-quoted-path",     'cat "secrets/.env"',                      "BLOCK"),

    ("block:git-head",               "cat .git/HEAD",                           "BLOCK"),
    ("block:git-config",             "bat .git/config",                         "BLOCK"),

    ("block:waste-cat-nm",           "cat node_modules/foo/package.json",       "BLOCK"),
    ("block:waste-rg-nm",            "rg pattern node_modules/",                "BLOCK"),
    ("block:waste-grep-dist",        "grep -r foo dist/",                       "BLOCK"),
    ("block:waste-tree-nm",          "tree node_modules/",                      "BLOCK"),
    ("block:waste-next",             "cat .next/cache/webpack/foo",             "BLOCK"),
    ("block:waste-pycache",          "bat __pycache__/foo.pyc",                 "BLOCK"),
    ("block:waste-venv-cat",         "cat .venv/lib/foo.py",                    "BLOCK"),
    ("block:waste-absolute-build",   "cat /home/u/build/x.log",                 "BLOCK"),
    ("block:waste-dotslash-build",   "cat ./build/x",                           "BLOCK"),
    ("block:waste-bounded-pipe",     "cat build/x.log | head -20",              "BLOCK"),

    ("block:compound-cat-env",       "ls && cat .env",                          "BLOCK"),

    ("allow:env-example",            "cat .env.example",                        "ALLOW"),
    ("allow:env-sample",             "cat .env.sample",                         "ALLOW"),
    ("allow:env-template",           "cat .env.template",                       "ALLOW"),
    ("allow:env-dist",               "cat .env.dist",                           "ALLOW"),
    ("allow:env-example-old",        "cat .env.example.old",                    "ALLOW"),
    ("allow:envrc",                  "cat .envrc",                              "ALLOW"),

    ("allow:find-env-glob",          "find . -type f -name '.env*'",            "ALLOW"),
    ("allow:find-tmp",               "find /tmp -type d",                       "ALLOW"),
    ("allow:find-in-nm",             "find node_modules -name 'package.json'",  "ALLOW"),
    ("allow:ls-nm",                  "ls node_modules/",                        "ALLOW"),
    ("allow:ls-la-nm",               "ls -la node_modules/",                    "ALLOW"),
    ("allow:ls-R-src",               "ls -R src/",                              "ALLOW"),

    ("allow:exclude-dir",            "rg --exclude-dir=node_modules foo .",     "ALLOW"),
    ("allow:exclude-eq",             "grep --exclude=build/* foo src/",         "ALLOW"),

    ("allow:word-build-rg",          'rg "build" src/',                         "ALLOW"),
    ("allow:file-build-sh",          "cat scripts/build.sh",                    "ALLOW"),
    ("allow:dist-substring",         "rg foo docs/dist-architecture.md",        "ALLOW"),
    ("allow:dash-prefix",            "cat myproject-build-tools/x",             "ALLOW"),
    ("allow:rebuild",                "cat rebuild/foo",                         "ALLOW"),
    ("allow:builds-plural",          "cat builds/foo",                          "ALLOW"),
    ("allow:nm-no-slash",            "cat node_modules",                        "ALLOW"),

    ("allow:npm-run-build",          "npm run build",                           "ALLOW"),
    ("allow:cargo-build",            "cargo build --release",                   "ALLOW"),
    ("allow:go-build",               "go build ./...",                          "ALLOW"),
    ("allow:make-build",             "make build",                              "ALLOW"),
    ("allow:pip-install",            "pip install requests",                    "ALLOW"),

    ("allow:git-diff-build",         "git diff build/foo.log",                  "ALLOW"),
    ("allow:git-log-build",          "git log build/foo",                       "ALLOW"),
    ("allow:git-show-build",         "git show HEAD:build/foo",                 "ALLOW"),
    ("allow:git-add-build",          "git add build/foo",                       "ALLOW"),
    ("allow:git-blame-build",        "git blame build/foo",                     "ALLOW"),
    ("allow:git-log-oneline",        "git log --oneline -20",                   "ALLOW"),

    ("allow:cd-build",               "cd build/",                               "ALLOW"),
    ("allow:pushd-dist",             "pushd dist/",                             "ALLOW"),
    ("allow:cd-build-no-slash",      "cd build && ls",                          "ALLOW"),

    ("allow:echo-redirect-build",    "echo x > build/out.log",                  "ALLOW"),
    ("allow:cp-into-build",          "cp file build/",                          "ALLOW"),
    ("allow:tar-extract-build",      "tar -xf foo -C build/",                   "ALLOW"),

    ("allow:rm-rf-nm",               "rm -rf node_modules",                     "ALLOW"),
    ("allow:mkdir-dist",             "mkdir -p dist/out",                       "ALLOW"),
    ("allow:rm-rf-dotenv",           "rm -rf .env",                             "ALLOW"),
    ("allow:npm-install",            "npm install",                             "ALLOW"),

    ("allow:source-env",             "source .env",                             "ALLOW"),

    ("block:install-then-catenv",    "install foo && cat .env",                 "BLOCK"),
    ("block:mkdir-then-catenv",      "mkdir foo && cat .env",                   "BLOCK"),
    ("block:rmrf-then-cat-git",      "rm -rf foo && cat .git/HEAD",             "BLOCK"),
    ("block:install-then-cat-git",   "install x && cat .git/config",            "BLOCK"),
    ("allow:rm-rf-still-allows-nm",  "rm -rf node_modules/.cache",              "ALLOW"),

    ("allow:close-comment-quotes-dotenv-read",
     "gh issue close 91 --comment 'Closing record: verified via `cat .env` - MET'",
     "ALLOW"),
    ("allow:close-comment-quotes-dir-grep",
     "gh issue close 92 --comment 'Closing record: verified via `grep foo dist/` - MET'",
     "ALLOW"),
    ("allow:close-heredoc-quotes-dotenv-read",
     "gh issue close 93 --comment \"$(cat <<'EOF'\n"
     "Closing record: verified via `cat .env` - MET\n"
     "EOF\n)\"",
     "ALLOW"),
    ("allow:close-heredoc-quotes-dir-grep",
     "gh issue close 94 --comment \"$(cat <<'EOF'\n"
     "Closing record: verified via `grep foo dist/` - MET\n"
     "EOF\n)\"",
     "ALLOW"),
    ("allow:bare-heredoc-body-is-data",
     "cat <<'EOF' | grep -v foo\n"
     "mentions cat .env only as data, not a read\n"
     "EOF",
     "ALLOW"),

    ("block:boundary-bare-dotenv-read",  "cat .env",       "BLOCK"),
    ("block:boundary-bare-dir-grep",     "grep foo dist/", "BLOCK"),

    ("block:gh-issue-create",
     "gh issue create --title x --body y",
     "BLOCK"),
    ("allow:file-issue-helper",
     "~/bin/file-issue ticket --title x",
     "ALLOW"),
    ("allow:gh-issue-create-quoted",
     "gh issue comment 5 --body 'run gh issue create later'",
     "ALLOW"),

    ("block:gh-issue-close-compound",
     "git push && gh issue close 5",
     "BLOCK"),
    ("allow:gh-issue-close-comment-quoted-operator",
     'gh issue close 5 --comment "a && b"',
     "ALLOW"),
    ("allow:gh-issue-close-alone",
     "gh issue close 5",
     "ALLOW"),

    ("block:commit-closes-dquote",
     'git commit -m "Resolves #176"',
     "BLOCK"),
    ("block:commit-closes-squote",
     "git commit -m 'Fixes #176'",
     "BLOCK"),
    ("block:commit-closes-am-flag",
     'git add -A && git commit -am "Closes #12" && git push',
     "BLOCK"),
    ("block:commit-closes-heredoc",
     "git commit -m \"$(cat <<'EOF'\n"
     "Resolves #176\n"
     "\n"
     "Body text\n"
     "EOF\n)\"",
     "BLOCK"),
    ("block:commit-closes-cross-repo",
     'git commit -m "fixes owner/repo#392"',
     "BLOCK"),
    ("block:commit-closes-lowercase",
     'git commit -m "closed #176"',
     "BLOCK"),

    ("allow:commit-refs-only",
     'git commit -m "Refs #176"',
     "ALLOW"),
    ("allow:commit-bare-issue-number",
     'git commit -m "test: author acceptance tests for #402"',
     "ALLOW"),
    ("allow:commit-no-message-flag",
     "git commit --amend --no-edit",
     "ALLOW"),
    ("block:pr-closes-create-body",
     'gh pr create --title "t" --body "Built it.\n\nCloses #402"',
     "BLOCK"),
    ("block:pr-closes-edit-short-flag",
     "gh pr edit 492 -b 'Fixes #402'",
     "BLOCK"),
    ("block:pr-closes-heredoc",
     "gh pr create --title t --body \"$(cat <<'EOF'\n"
     "Built it.\n"
     "\n"
     "Resolves #402\n"
     "EOF\n)\"",
     "BLOCK"),
    ("allow:pr-ticket-reference",
     'gh pr create --title "t" --body "Built it.\n\nTicket: #402"',
     "ALLOW"),
    ("allow:pr-keyword-in-title-only",
     'gh pr create --title "Fixes #402" --body "Built it."',
     "ALLOW"),
    ("allow:comment-mentions-keyword-not-commit",
     'gh issue comment 5 --body "Fixes #176 was reverted"',
     "ALLOW"),
]

MALFORMED = [(f"malformed:{label}", raw, "ALLOW") for label, raw in _harness.MALFORMED_STDIN] + [
    ("malformed:missing-command", b'{"tool_input":{}}', "ALLOW"),
]

def grade(stdin_bytes):
    run_result = _harness.run_hook(HOOK, stdin_bytes, env=ENV)
    r, out, hso = run_result.proc, run_result.output, run_result.hook_specific_output
    blocked = r.returncode == 2
    if not blocked:
        dec = out.get("decision")
        if dec == "block" or hso.get("decision") == "block":
            blocked = True
        behavior = (hso.get("decision") or {}) if isinstance(hso.get("decision"), dict) else {}
        if behavior.get("behavior") == "deny":
            blocked = True
        if run_result.denied:
            blocked = True
    return "BLOCK" if blocked else "ALLOW"

def check_block_carries_system_message():
    cat, cmd = "meta:block-carries-system-message", "cat .env"
    want = "systemMessage naming validate-bash + permissionDecision=deny"
    payload = json.dumps({"tool_input": {"command": cmd}}).encode()
    run_result = _harness.run_hook(HOOK, payload, env=ENV)
    r, out, hso = run_result.proc, run_result.output, run_result.hook_specific_output
    got = f"exit={r.returncode} stdout={r.stdout!r} stderr={r.stderr!r}"
    sysmsg = out.get("systemMessage", "")
    ok = (r.returncode == 0 and sysmsg and "validate-bash" in sysmsg
          and hso.get("permissionDecision") == "deny")
    return (cat, cmd, want, sysmsg if ok else got, ok)

GUARD_BY_CASE = {
    "block:dotenv": "dotenv",
    "block:git": "git-internals",
    "block:waste": "wasteful-dir",
    "block:compound-cat-env": "dotenv",
    "block:gh-issue-create": "gh-issue-create",
    "block:gh-issue-close-compound": "compound-close",
    "block:commit-closes": "commit-closes-ticket",
    "block:pr-closes": "pr-closes-ticket",
}


def guard_for(cat):
    matches = [g for prefix, g in GUARD_BY_CASE.items() if cat.startswith(prefix)]
    return matches[0] if len(matches) == 1 else None


def check_rows():
    fires = len(CASES) + len(MALFORMED) + 1
    rows = _harness.rows(LOG_DIR, "validate-bash")
    out = [("row:count", f"{fires} fires", str(fires), str(len(rows)), len(rows) == fires)]

    verdicts = {r.get("verdict") for r in rows}
    out.append(("row:vocabulary", "allow|deny only", "{'allow', 'deny'}", str(sorted(verdicts)),
                verdicts <= {"allow", "deny"}))

    denies = len([c for c in CASES if c[2] == "BLOCK"]) + 1
    logged_denies = [r for r in rows if r.get("verdict") == "deny"]
    out.append(("row:deny-count", "every BLOCK logged a deny", str(denies),
                str(len(logged_denies)), len(logged_denies) == denies))

    slugless = [r for r in logged_denies if not r.get("guard")]
    out.append(("row:deny-carries-guard", "every deny row names its guard", "0 slugless",
                str(len(slugless)), not slugless))

    for cat, cmd, want in CASES:
        guard = guard_for(cat) if want == "BLOCK" else None
        if guard is None:
            continue
        _harness.run_hook(HOOK, json.dumps({"tool_input": {"command": cmd}}).encode(),
                          env=SOLO.env())
        got = [r.get("guard") for r in SOLO.last("validate-bash")]
        out.append((f"guard:{cat}", cmd, guard, str(got), got == [guard]))
    return out


def main():
    results = []
    for cat, cmd, want in CASES:
        payload = json.dumps({"tool_input": {"command": cmd}}).encode()
        got = grade(payload)
        results.append((cat, cmd, want, got, want == got))
    for cat, stdin, want in MALFORMED:
        got = grade(stdin)
        results.append((cat, repr(stdin), want, got, want == got))
    results.append(check_block_carries_system_message())
    results += check_rows()
    shutil.rmtree(LOG_DIR, ignore_errors=True)
    SOLO.cleanup()

    _harness.diff_baseline(results)

if __name__ == "__main__":
    main()
