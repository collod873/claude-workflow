#!/usr/bin/env python3
import json
import os
import sys
import time

import _hook

mode = os.environ.get("STUB_MODE", "json")

argv_log = os.environ.get("STUB_ARGV_LOG")
if argv_log:
    _hook.append_log(
        "stub_gh",
        {"argv": sys.argv[1:], "cwd": os.getcwd(), "GH_REPO": os.environ.get("GH_REPO")},
        path=argv_log,
    )

if mode == "sleep":
    time.sleep(float(os.environ.get("STUB_SLEEP", "30")))
    sys.stdout.write(os.environ.get("STUB_JSON", "{}"))
    sys.exit(0)

if mode == "fail":
    sys.stderr.write("gh: authentication failed, please run `gh auth login`\n")
    sys.exit(1)

repo_json = os.environ.get("STUB_REPO_JSON")
if repo_json and sys.argv[1:3] == ["repo", "view"]:
    sys.stdout.write(repo_json)
    sys.exit(0)

graphql_json = os.environ.get("STUB_GRAPHQL_JSON")
if graphql_json and sys.argv[1:3] == ["api", "graphql"]:
    sys.stdout.write(graphql_json)
    sys.exit(0)

by_issue = os.environ.get("STUB_JSON_BY_ISSUE")
if by_issue:
    table = json.loads(by_issue)
    argv = sys.argv[1:]
    number = argv[argv.index("view") + 1] if "view" in argv[:-1] else None
    if number is not None and number in table:
        sys.stdout.write(json.dumps(table[number]))
        sys.exit(0)
    if number is not None and "state" in argv:
        sys.stderr.write(f"gh: issue #{number} not found\n")
        sys.exit(1)

sys.stdout.write(os.environ.get("STUB_JSON", "{}"))
sys.exit(0)
