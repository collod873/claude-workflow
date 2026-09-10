#!/usr/bin/env python3
import json
from pathlib import Path

import _harness

HOOK = Path(__file__).with_name("credential-scan.py")

ROWLOG = _harness.RowLog("credential-scan-log-")

CLEAN = "def add(a, b):\n    return a + b\n"

AWS_KEY = "AKIAQWERTYUIOPASDFGH"
AWS_SECRET = "abcdefghijabcdefghijabcdefghijabcdefghij"
GH_TOKEN = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
LONG_BODY = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6"
STRIPE_KEY = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc"

CASES = [
    ("block:aws-access-key",   {"file_path": "cfg.py", "content": f'KEY = "{AWS_KEY}"'},                                "BLOCK"),
    ("block:aws-secret-key",   {"file_path": "cfg.py", "content": f'aws_secret_access_key = "{AWS_SECRET}"'},           "BLOCK"),
    ("block:github-token",     {"file_path": "cfg.py", "content": f'TOKEN = "{GH_TOKEN}"'},                             "BLOCK"),
    ("block:slack-token",      {"file_path": "cfg.py", "content": 'SLACK = "xoxb-1234567890-abcdefghij"'},              "BLOCK"),
    ("block:stripe-live-key",  {"file_path": "cfg.py", "content": f'STRIPE = "{STRIPE_KEY}"'},                          "BLOCK"),
    ("block:openai-key",       {"file_path": "cfg.py", "content": f'OPENAI = "sk-{LONG_BODY}"'},                        "BLOCK"),
    ("block:anthropic-key",    {"file_path": "cfg.py", "content": f'ANTHROPIC = "sk-ant-{LONG_BODY}"'},                 "BLOCK"),

    ("block:generic-api-key",  {"file_path": "cfg.py", "content": 'api_key = "aBcDeFgH12345678JkLmNo"'},                "BLOCK"),
    ("block:generic-password", {"file_path": "cfg.py", "content": 'password = "hunter2hunter2hunter2"'},                "BLOCK"),
    ("block:bearer-token",     {"file_path": "cfg.py", "content": f'authorization: "Bearer {LONG_BODY}"'},              "BLOCK"),
    ("block:private-key-pem",  {"file_path": "id_rsa", "content": "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n"},           "BLOCK"),
    ("block:dotenv-value",     {"file_path": ".env", "content": f"API_KEY={GH_TOKEN}"},                                 "BLOCK"),

    ("block:edit-new-string",  {"file_path": "cfg.py", "old_string": "x", "new_string": f'T = "{GH_TOKEN}"'},           "BLOCK"),

    ("block:notebook-new-source",  {"notebook_path": "nb.ipynb", "cell_id": "c1", "new_source": f'T = "{GH_TOKEN}"'},   "BLOCK"),
    ("block:multiedit-second-edit", {"file_path": "cfg.py", "edits": [
        {"old_string": "a", "new_string": "harmless = 1"},
        {"old_string": "b", "new_string": f'T = "{GH_TOKEN}"'}]},                                                       "BLOCK"),
    ("allow:notebook-clean",       {"notebook_path": "nb.ipynb", "cell_id": "c1", "new_source": "import pandas as pd"}, "ALLOW"),
    ("allow:multiedit-clean",      {"file_path": "cfg.py", "edits": [{"old_string": "a", "new_string": "x = 1"}]},      "ALLOW"),
    ("allow:edit-removes-secret",  {"file_path": "cfg.py", "old_string": f'T = "{GH_TOKEN}"', "new_string": "T = os.environ['T']"}, "ALLOW"),

    ("block:near-miss-name",   {"file_path": "my-credential-scan.py", "content": f'K = "{AWS_KEY}"'},                   "BLOCK"),
    ("block:near-miss-env",    {"file_path": ".env.local", "content": f'K = "{AWS_KEY}"'},                              "BLOCK"),

    ("allow:clean-write",      {"file_path": "app.py", "content": CLEAN},                                               "ALLOW"),
    ("allow:clean-edit",       {"file_path": "app.py", "old_string": "a", "new_string": CLEAN},                         "ALLOW"),
    ("allow:no-content-field", {"file_path": "app.py"},                                                                 "ALLOW"),
    ("allow:empty-content",    {"file_path": "app.py", "content": ""},                                                  "ALLOW"),

    ("allow:placeholder-your", {"file_path": "cfg.py", "content": 'api_key = "your_api_key_goes_here_1234"'},           "ALLOW"),
    ("allow:placeholder-eg",   {"file_path": "cfg.py", "content": 'token = "example_token_1234567890"'},                "ALLOW"),
    ("allow:no-digit-ident",   {"file_path": "cfg.py", "content": "token = get_access_token_value"},                    "ALLOW"),

    ("allow:exempt-hook",      {"file_path": "/h/.claude/hooks/credential-scan.py", "content": f'K = "{AWS_KEY}"'},     "ALLOW"),
    ("allow:exempt-harness",   {"file_path": "/h/.claude/hooks/test_credential_scan.py", "content": f'K = "{AWS_KEY}"'}, "ALLOW"),
    ("allow:exempt-env-eg",    {"file_path": "/p/.env.example", "content": f"KEY={AWS_KEY}"},                           "ALLOW"),
    ("allow:exempt-gitignore", {"file_path": ".gitignore", "content": f"# {AWS_KEY}\n"},                                "ALLOW"),
]

MALFORMED = [(f"malformed:{label}", raw, "ALLOW") for label, raw in _harness.MALFORMED_STDIN] + [
    ("malformed:truncated-json",     b'{"tool_input": {"content":',      "ALLOW"),
    ("malformed:tool-input-null",    b'{"tool_input": null}',            "ALLOW"),
]


def run(stdin_bytes):
    return _harness.run_hook(HOOK, stdin_bytes, env=ROWLOG.env())


def fire(stdin_bytes):
    result = run(stdin_bytes)
    return result, ROWLOG.last("credential-scan")


VOLATILE_ROW_KEYS = ("ts", "seconds")


def stable(rows):
    return [{k: v for k, v in row.items() if k not in VOLATILE_ROW_KEYS} for row in rows]


def check_census():
    out = []
    expected = {
        "block:aws-access-key": ("deny", "aws-access-key"),
        "block:github-token": ("deny", "github-token"),
        "allow:clean-write": ("allow", None),
        "allow:exempt-hook": ("exempt", None),
        "allow:exempt-gitignore": ("exempt", None),
    }
    by_cat = {cat: ti for cat, ti, _ in CASES}
    for cat, (verdict, pattern) in expected.items():
        _, rows = fire(json.dumps({"tool_input": by_cat[cat]}).encode())
        want = f"1 row, verdict={verdict}" + (f", {pattern} among patterns" if pattern else "")
        ok = (len(rows) == 1 and rows[0].get("verdict") == verdict
              and (pattern is None or pattern in (rows[0].get("patterns") or [])))
        out.append((f"row:{cat}", cat, want, str(stable(rows)), ok))

    for label, raw in _harness.MALFORMED_STDIN:
        _, rows = fire(raw)
        out.append((f"row:malformed:{label}", repr(raw), "1 row, verdict=allow", str(stable(rows)),
                    len(rows) == 1 and rows[0].get("verdict") == "allow"))
    return out


def grade(stdin_bytes):
    run_result = run(stdin_bytes)
    r = run_result.proc
    blocked = r.returncode == 2
    if not blocked and (run_result.denied or run_result.output.get("decision") == "block"):
        blocked = True
    return "BLOCK" if blocked else "ALLOW"


def check_block_channel():
    cat = "meta:denied-and-names-hook"
    subject = f'KEY = "{AWS_KEY}"'
    want = "denied + systemMessage naming credential-scan"
    payload = json.dumps({"tool_input": {"file_path": "cfg.py", "content": subject}}).encode()
    run_result = run(payload)
    sysmsg = run_result.output.get("systemMessage", "")
    got = (f"denied={run_result.denied} stdout={run_result.proc.stdout[:160]!r} "
           f"stderr={run_result.proc.stderr[:80]!r}")
    if run_result.denied and sysmsg and "credential-scan" in sysmsg:
        return (cat, subject, want, sysmsg.splitlines()[0], True)
    return (cat, subject, want, got, False)


def check_clean_is_silent():
    cat = "meta:clean-edit-is-silent"
    want = "exit 0, empty stdout, empty stderr"
    payload = json.dumps({"tool_input": {"file_path": "app.py", "content": CLEAN}}).encode()
    r = run(payload).proc
    got = f"exit={r.returncode} stdout={r.stdout!r} stderr={r.stderr!r}"
    ok = r.returncode == 0 and not r.stdout.strip() and not r.stderr.strip()
    return (cat, "clean write", want, want if ok else got, ok)


def check_never_exits_two():
    cat = "meta:never-exits-2"
    want = "no exit 2 on any case"
    offenders = []
    for label, ti, _ in CASES:
        if run(json.dumps({"tool_input": ti}).encode()).proc.returncode == 2:
            offenders.append(label)
    for label, raw, _ in MALFORMED:
        if run(raw).proc.returncode == 2:
            offenders.append(label)
    ok = not offenders
    return (cat, "all cases", want, want if ok else f"exit 2 on: {offenders}", ok)


def check_no_path_crashes():
    cat = "meta:no-path-crashes"
    want = "every path exits 0 or 2, never 1, and never traces back"
    offenders = []
    for label, ti, _ in CASES:
        r = run(json.dumps({"tool_input": ti}).encode()).proc
        if r.returncode not in (0, 2) or b"Traceback" in r.stderr:
            offenders.append(label)
    for label, raw, _ in MALFORMED:
        r = run(raw).proc
        if r.returncode not in (0, 2) or b"Traceback" in r.stderr:
            offenders.append(label)
    ok = not offenders
    return (cat, "all cases", want, want if ok else f"crashed on: {offenders}", ok)


def main():
    results = []
    for cat, tool_input, want in CASES:
        payload = json.dumps({"tool_input": tool_input}).encode()
        got = grade(payload)
        subject = json.dumps(tool_input).replace(STRIPE_KEY, "sk_live_<fixture>")[:90]
        results.append((cat, subject, want, got, want == got))
    for cat, stdin, want in MALFORMED:
        got = grade(stdin)
        results.append((cat, repr(stdin), want, got, want == got))
    results.append(check_block_channel())
    results.append(check_clean_is_silent())
    results.append(check_never_exits_two())
    results.append(check_no_path_crashes())
    results += check_census()
    ROWLOG.cleanup()

    _harness.diff_baseline(results)


if __name__ == "__main__":
    main()
