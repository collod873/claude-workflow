#!/usr/bin/env python3
"""The one harness hook per event, routing to the roster.

Every behavioural rule here is measured against the live product, never read from the hooks
reference, which is wrong in fifteen places we have checked. Verdict ids are cited inline so a
claim and its evidence cannot drift apart.

  exit.json-read-on-every-exit-code / other.valid-json-decides
      Valid JSON on stdout is read and obeyed whatever the child exited with. So a child's answer
      is parsed before its exit code is judged, and a child that answered is never "broken".

  PreToolUse.precedence / PermissionRequest.multiple-conflicting
      deny > defer > ask > allow, regardless of order. Decisions are ranked, never absorbed
      first-writer-wins, and every refusal's reason is kept.

  PostToolUse.decision-block
      A top-level decision:"block" delivers its reason to Claude as a system reminder on the tool
      result. That is the channel the expensive hooks speak through, so it is what the cap bounds.

A broken hook on a deciding event is an absent guard, so the slot refuses on its behalf and names
it rather than going quiet.
"""
import json
import os
import subprocess
import sys
from datetime import datetime
from hashlib import blake2b
from pathlib import Path

import _hook

HOOKS_DIR = Path(__file__).resolve().parent
ROSTER_PATH = HOOKS_DIR / "roster.json"
HOOK_TIMEOUT_SECONDS = 300
TRACEBACK_MARKER = "Traceback (most recent call last):"

DECIDING = {"PreToolUse", "PermissionRequest"}
RANK = {"deny": 4, "block": 4, "defer": 3, "ask": 2, "allow": 1}

SAY_LITTLE = 200
UNCAPPED_EVENTS = {"SessionStart", "SessionEnd"}
SPILL_LOG = "dispatch-spill"
SPILL_RETENTION_DAYS = 7


def roster() -> dict:
    return json.loads(ROSTER_PATH.read_text())


def argv_for(hook_path: Path) -> list[str]:
    if hook_path.suffix == ".py":
        return [sys.executable, str(hook_path)]
    return [str(hook_path)]


def answer_of(stdout: bytes) -> dict | None:
    text = stdout.strip()
    if not text:
        return None
    try:
        doc = json.loads(text)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


def run_one(name: str, stdin_bytes: bytes, env: dict) -> dict:
    row = {"hook": name, "answer": None, "code": None, "stdout": b"", "stderr": b"", "broken": False}
    path = HOOKS_DIR / name
    if not path.is_file():
        return {**row, "code": 1, "broken": True,
                "stderr": f"{name}: no such hook file\n".encode()}
    try:
        proc = subprocess.run(argv_for(path), input=stdin_bytes, capture_output=True,
                              env=env, timeout=HOOK_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        return {**row, "code": 1, "broken": True,
                "stderr": f"{name}: exceeded its {HOOK_TIMEOUT_SECONDS}s dispatcher timeout\n".encode()}
    except OSError as exc:
        return {**row, "code": 1, "broken": True,
                "stderr": f"{name}: could not run ({exc})\n".encode()}

    stderr = proc.stderr.decode("utf-8", "replace")
    row.update(answer=answer_of(proc.stdout), code=proc.returncode,
               stdout=proc.stdout, stderr=proc.stderr)
    if row["answer"] is None and (proc.returncode not in (0, 2) or TRACEBACK_MARKER in stderr):
        row["broken"] = True
    return row


def decision_of(doc: dict) -> str | None:
    specific = doc.get("hookSpecificOutput") or {}
    found = specific.get("permissionDecision") or (specific.get("decision") or {}).get("behavior")
    if found in RANK:
        return found
    return "block" if doc.get("decision") == "block" else None


def reason_of(doc: dict) -> str:
    specific = doc.get("hookSpecificOutput") or {}
    return (specific.get("permissionDecisionReason")
            or (specific.get("decision") or {}).get("message")
            or doc.get("reason") or "")


def spill(event: str, text: str) -> str:
    marker = blake2b(text.encode("utf-8", "replace"), digest_size=4).hexdigest()
    _hook.append_log(SPILL_LOG, {"event": event, "id": marker, "chars": len(text), "text": text},
                     retain_days=SPILL_RETENTION_DAYS)
    path = _hook.LOG_DIR / f"{SPILL_LOG}-{datetime.now():%Y-%m-%d}.jsonl"
    return f"[+{len(text)} chars: {path} id={marker}]"


class Budget:

    def __init__(self, event: str):
        self.event = event
        self.left = None if event in UNCAPPED_EVENTS else SAY_LITTLE

    def spend(self, text: str) -> str:
        if not text or self.left is None:
            return text
        if len(text) <= self.left:
            self.left -= len(text)
            return text
        pointer = spill(self.event, text)
        kept = text[:self.left].rstrip()
        self.left = 0
        return f"{kept} {pointer}" if kept else pointer


def collect(rows: list[dict]) -> dict:
    parts = {"decision": None, "reasons": [], "contexts": [], "messages": [],
             "specific": {}, "top": {}}
    decisions = []
    for row in rows:
        doc = row["answer"]
        if not doc:
            continue
        found = decision_of(doc)
        if found:
            decisions.append(found)
            if RANK[found] == RANK["deny"] and reason_of(doc):
                parts["reasons"].append(reason_of(doc))
        for key, value in (doc.get("hookSpecificOutput") or {}).items():
            if key == "additionalContext" and isinstance(value, str):
                parts["contexts"].append(value)
            elif key not in ("hookEventName", "permissionDecision", "permissionDecisionReason",
                             "decision"):
                parts["specific"].setdefault(key, value)
        if isinstance(doc.get("systemMessage"), str):
            parts["messages"].append(doc["systemMessage"])
        for key, value in doc.items():
            if key in ("hookSpecificOutput", "systemMessage", "decision", "reason"):
                continue
            if key == "continue" and value is False:
                parts["top"][key] = False
            else:
                parts["top"].setdefault(key, value)
    if decisions:
        parts["decision"] = max(decisions, key=lambda d: RANK[d])
    return parts


def render(parts: dict, event: str, texts: list[bytes]) -> bytes:
    out: dict = dict(parts["top"])
    specific: dict = dict(parts["specific"])
    budget = Budget(event)
    decision = parts["decision"]
    reason = budget.spend("\n".join(parts["reasons"]))

    if decision:
        if event == "PermissionRequest":
            behaviour = "deny" if decision == "block" else decision
            specific["decision"] = {"behavior": behaviour}
            if behaviour == "deny" and reason:
                specific["decision"]["message"] = reason
        elif event in DECIDING:
            specific["permissionDecision"] = "deny" if decision == "block" else decision
            if reason:
                specific["permissionDecisionReason"] = reason
        elif RANK[decision] == RANK["deny"]:
            out["decision"] = "block"
            if reason:
                out["reason"] = reason

    context = budget.spend("\n".join(parts["contexts"]))
    if context:
        specific["additionalContext"] = context
    if specific:
        specific["hookEventName"] = event
        out["hookSpecificOutput"] = specific
    message = Budget(event).spend("\n".join(parts["messages"]))
    if message:
        out["systemMessage"] = message

    plain = budget.spend("\n".join(t.decode("utf-8", "replace") for t in texts))
    if not out:
        return plain.encode()
    merged = json.dumps(out).encode()
    return merged + b"\n" + plain.encode() if plain else merged


def refuse(event: str, why: str) -> dict:
    text = f"[dispatch] {why}; the check could not run, so this is refused rather than allowed"
    if event == "PermissionRequest":
        return {"hookSpecificOutput": {"hookEventName": event,
                                       "decision": {"behavior": "deny", "message": text}}}
    return {"hookSpecificOutput": {"hookEventName": event, "permissionDecision": "deny",
                                   "permissionDecisionReason": text}}


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: dispatch.py <Event>", file=sys.stderr)
        return 2

    event = argv[0]
    stdin_bytes = _hook.read_stdin_bytes()
    names = roster().get(event, [])
    env = dict(os.environ)

    rows = [run_one(name, stdin_bytes, env) for name in names]

    exit2 = [r for r in rows if r["code"] == 2]
    if exit2:
        joined = "".join(r["stderr"].decode("utf-8", "replace") for r in exit2)
        sys.stderr.write(Budget(event).spend(joined))
        return 2

    broken = [r for r in rows if r["broken"]]
    parts = collect(rows)
    if broken and event in DECIDING and parts["decision"] != "deny":
        parts = collect(rows + [{"answer": refuse(
            event, f"{', '.join(r['hook'] for r in broken)} could not run")}])

    texts = [r["stdout"].rstrip(b"\n") for r in rows
             if r["answer"] is None and not r["broken"] and r["stdout"].strip()]
    merged = render(parts, event, texts)
    if merged:
        sys.stdout.buffer.write(merged)

    if broken:
        sys.stderr.buffer.write(b"".join(r["stderr"] for r in broken))
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
