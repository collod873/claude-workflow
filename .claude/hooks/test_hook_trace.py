#!/usr/bin/env python3
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from _harness import check, finish

REPO = next((c for c in (Path(__file__).resolve().parent.parent, Path(__file__).resolve().parent.parent.parent) if (c / "bin").is_dir()), Path(__file__).resolve().parent.parent)
TRACE = REPO / "bin" / "hook-trace"
TMP = Path(tempfile.mkdtemp(prefix="hook-trace-fixture-"))
PROJECTS = TMP / "projects" / "-fixture"
LOGS = TMP / "logs"
SESSION = "fixture-session"
CLEAN = "clean-session"
AGENT = "a1234"

BASE = datetime.now() - timedelta(minutes=30)

DENY_TEXT = "[validate-bash] Reading .git/ internals; use git commands instead."
RAN_TEXT = "[validate-bash] gh issue create is blocked; file it through the tool instead."
STDERR_TEXT = "post-edit-validate: validator missing"
HANDBACK = "[stop-gate] UNRESOLVED: checks still failing after one retry."
HANDBACK_STDOUT = '{"systemMessage": "[stop-gate] UNRESOLVED"}'
BLOCK_TEXT = "[stop-gate] BLOCKED: 'bin/lint' failed; fix the violation it names."
GHOST_TEXT = "[ghost] a hook that speaks and logs nothing"
OVERRIDE = "A hook blocked the turn from ending 9 consecutive times"
SUBAGENT_DENY_TEXT = ("[validate-bash] Reading from a large generated directory wastes "
                     "context. Use a more targeted path, or pass --exclude-dir to skip it.")
NOT_MINE_TEXT = "[stop-gate] not-mine: another agent's worktree is dirty, not this turn's."
DEFERRED_TEXT = "[stop-gate] deferred: retry budget exhausted; picked up again next turn."
GAUNTLET_TEXT = "gauntlet: stop took 5927ms against a 5109ms budget"
UNATTRIBUTED_TEXT = "a plain line with no hook name anywhere in the whole sentence, prose"
USER_REJECTED_TEXT = ("The user doesn't want to proceed with this tool use. The tool use "
                     "was rejected. STOP what you are doing and wait for the user.")


def at(seconds: int) -> datetime:
    return BASE + timedelta(seconds=seconds)


def stamp(when: datetime) -> str:
    return when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def envelope(when: datetime, agent: str = "", **fields) -> dict:
    record = {"sessionId": SESSION, "timestamp": stamp(when), "cwd": "/home/collin/demo",
              "version": "2.1.260", "isSidechain": bool(agent), **fields}
    if agent:
        record["agentId"] = agent
    return record


def attachment(when: datetime, kind: str, agent: str = "", **body) -> dict:
    return envelope(when, agent, type="attachment", attachment={"type": kind, **body})


def tool_result(when: datetime, tool_use_id: str, *, error=False, denial="",
                agent: str = "", content: str = "output") -> dict:
    result = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
    if error:
        result["is_error"] = True
    record = envelope(when, agent, type="user",
                      message={"role": "user", "content": [result]})
    if denial:
        record["toolDenialKind"] = denial
    return record


def assistant(when: datetime) -> dict:
    return envelope(when, type="assistant",
                    message={"role": "assistant", "content": [{"type": "text",
                                                               "text": "carrying on"}]})


def prompt(when: datetime) -> dict:
    return envelope(when, type="user", message={"role": "user", "content": "next task"})


def summary(when: datetime, tool_use_id: str, infos: list, **fields) -> dict:
    body = {"hookCount": len(infos), "hookInfos": infos, "hookErrors": [],
            "hookAdditionalContext": [], "preventedContinuation": False,
            "stopReason": "", "hasOutput": True, "level": "suggestion",
            "toolUseID": tool_use_id, **fields}
    return envelope(when, type="system", subtype="stop_hook_summary", **body)


def main_records() -> list[dict]:
    return [
        attachment(at(0), "hook_system_message", content=DENY_TEXT,
                   hookName="PreToolUse:Bash", toolUseID="toolu_deny1",
                   hookEvent="PreToolUse"),
        tool_result(at(1), "toolu_deny1", error=True, denial="permission-rule"),

        attachment(at(10), "hook_system_message", content=RAN_TEXT,
                   hookName="PreToolUse:Bash", toolUseID="toolu_deny2",
                   hookEvent="PreToolUse"),
        tool_result(at(11), "toolu_deny2"),

        attachment(at(20), "hook_non_blocking_error", hookName="PostToolUse:Edit",
                   toolUseID="toolu_post1", hookEvent="PostToolUse", stderr=STDERR_TEXT,
                   stdout="", exitCode=127,
                   command="python3 ~/.claude/hooks/post-edit-validate.py", durationMs=3),
        tool_result(at(21), "toolu_post1"),

        attachment(at(30), "hook_permission_decision", decision="allow",
                   toolUseID="toolu_perm1", hookEvent="PermissionRequest"),

        attachment(at(40), "hook_success", hookName="Stop", toolUseID="turn-1",
                   hookEvent="Stop", content="", stdout=HANDBACK_STDOUT, stderr="",
                   exitCode=0, command="python3 ~/.claude/hooks/stop-gate.py",
                   durationMs=5482),
        attachment(at(40), "hook_additional_context", content=[HANDBACK],
                   hookName="Stop", toolUseID="turn-1", hookEvent="Stop"),
        attachment(at(40), "hook_system_message", content=HANDBACK, hookName="Stop",
                   toolUseID="turn-1", hookEvent="Stop"),
        summary(at(41), "turn-1", [
            {"command": "python3 ~/.claude/hooks/stop-fire-log.py", "durationMs": 22},
            {"command": "python3 ~/.claude/hooks/stop-gate.py", "durationMs": 5470},
        ]),
        assistant(at(42)),

        attachment(at(60), "hook_blocking_error", hookName="Stop", toolUseID="turn-2",
                   hookEvent="Stop", blockingError={"blockingError": BLOCK_TEXT}),
        summary(at(61), "turn-2",
                [{"command": "python3 ~/.claude/hooks/stop-gate.py", "durationMs": 900}],
                hookErrors=[BLOCK_TEXT]),
        envelope(at(62), type="user", isMeta=True,
                 message={"role": "user", "content": f"Stop hook feedback:\n{BLOCK_TEXT}"}),
        assistant(at(63)),

        attachment(at(80), "hook_cancelled", hookName="Stop", toolUseID="turn-3",
                   hookEvent="Stop", command="python3 ~/.claude/hooks/slow-gate.py",
                   durationMs=300000, timedOut=True, timeoutMs=300000),
        summary(at(81), "turn-3",
                [{"command": "python3 ~/.claude/hooks/slow-gate.py",
                  "durationMs": 300000}]),
        prompt(at(82)),

        envelope(at(90), type="system", subtype="informational", level="warning",
                 content=f"{OVERRIDE} - overriding and ending turn."),

        attachment(at(100), "hook_additional_context", content=[GHOST_TEXT],
                   hookName="PreToolUse:Bash", toolUseID="toolu_ghost",
                   hookEvent="PreToolUse"),

        attachment(at(120), "hook_additional_context", content=[NOT_MINE_TEXT],
                   hookName="Stop", toolUseID="turn-4", hookEvent="Stop"),
        summary(at(121), "turn-4",
                [{"command": "python3 ~/.claude/hooks/stop-gate.py", "durationMs": 40}]),
        assistant(at(122)),

        attachment(at(130), "hook_additional_context", content=[DEFERRED_TEXT],
                   hookName="Stop", toolUseID="turn-5", hookEvent="Stop"),
        summary(at(131), "turn-5",
                [{"command": "python3 ~/.claude/hooks/stop-gate.py", "durationMs": 40}]),
        assistant(at(132)),

        attachment(at(140), "hook_system_message", content=GAUNTLET_TEXT,
                   hookName="Stop", toolUseID="turn-6", hookEvent="Stop"),
        summary(at(141), "turn-6",
                [{"command": "python3 ~/.claude/hooks/gauntlet.py", "durationMs": 40}]),
        assistant(at(142)),

        attachment(at(150), "hook_additional_context", content=[UNATTRIBUTED_TEXT],
                   hookName="PreToolUse:Bash", toolUseID="toolu_unknown",
                   hookEvent="PreToolUse"),
        tool_result(at(151), "toolu_unknown"),

        tool_result(at(160), "toolu_rejected", error=True, denial="user-rejected",
                    content=USER_REJECTED_TEXT),
    ]


def agent_records() -> list[dict]:
    return [
        attachment(at(50), "hook_system_message", agent=AGENT, content=DENY_TEXT,
                   hookName="PreToolUse:Bash", toolUseID="toolu_sub1",
                   hookEvent="PreToolUse"),
        tool_result(at(51), "toolu_sub1", error=True, denial="permission-rule",
                    agent=AGENT),
        tool_result(at(52), "toolu_sub2", error=True, denial="permission-rule",
                    agent=AGENT, content=SUBAGENT_DENY_TEXT),
    ]


def row(hook, event, verdict, when, **extra) -> dict:
    return dict({"hook": hook, "event": event, "session_id": SESSION,
                 "project": "demo", "verdict": verdict, "seconds": 0.01,
                 "ts": when.isoformat(timespec="seconds")}, **extra)


def rows() -> list[dict]:
    return [
        row("validate-bash", "PreToolUse", "deny", at(0), tool_use_id="toolu_deny1",
            guard="dotenv"),
        row("validate-bash", "PreToolUse", "deny", at(10), tool_use_id="toolu_deny2",
            guard="gh-issue-create"),
        row("post-edit-validate", "PostToolUse", "error", at(20),
            tool_use_id="toolu_post1"),
        row("auto-approve-permissions", "PermissionRequest", "allow", at(30),
            tool_use_id="toolu_perm1"),
        row("stop-fire-log", "Stop", "fire", at(40)),
        row("stop-gate", "Stop", "handback", at(41)),
        row("stop-gate", "Stop", "block", at(61), released="block"),
        row("validate-bash", "PreToolUse", "deny", at(50), tool_use_id="toolu_sub1",
            project="agent-a1234"),
        row("validate-bash", "PreToolUse", "deny", at(52), tool_use_id="toolu_sub2",
            project="agent-a1234"),
        row("stop-gate", "Stop", "not-mine", at(121), released="not-mine"),
        row("stop-gate", "Stop", "deferred", at(131), released="deferred"),
        row("mystery-hook", "PreToolUse", "noted", at(150), tool_use_id="toolu_unknown"),
        row("validate-bash", "PreToolUse", "allow", at(161),
            tool_use_id="toolu_nearby_allow"),
        row("close-gate", "PreToolUse", "deny", at(110), tool_use_id="toolu_missing"),
        dict(row("validate-bash", "PreToolUse", "deny", at(0),
                 tool_use_id="toolu_clean"), session_id=CLEAN),
    ]


def write_transcript(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")


def build_fixture() -> None:
    write_transcript(PROJECTS / f"{SESSION}.jsonl", main_records())
    write_transcript(PROJECTS / SESSION / "subagents" / f"agent-{AGENT}.jsonl",
                     agent_records())
    write_transcript(PROJECTS / f"{CLEAN}.jsonl", [
        attachment(at(0), "hook_system_message", content=DENY_TEXT,
                   hookName="PreToolUse:Bash", toolUseID="toolu_clean",
                   hookEvent="PreToolUse"),
        tool_result(at(1), "toolu_clean", error=True, denial="permission-rule"),
    ])
    LOGS.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    for hook in {r["hook"] for r in rows()}:
        mine = [r for r in rows() if r["hook"] == hook]
        (LOGS / f"{hook}-{today}.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in mine), encoding="utf-8")


def run(*args, transcript: Path | None = None):
    target = PROJECTS / f"{SESSION}.jsonl" if transcript is None else transcript
    return subprocess.run(
        [sys.executable, str(TRACE), str(target), "--log-dir", str(LOGS), *args],
        capture_output=True, text=True)


COLUMNS = ["hook", "event", "agent", "verdict", "channel", "audience", "chars", "ms",
           "outcome"]


def table(out: str) -> list[dict]:
    lines = []
    for line in out.splitlines():
        if not line.startswith("| ") or line.startswith("| hook |"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) == len(COLUMNS):
            lines.append(dict(zip(COLUMNS, cells)))
    return lines


def one(out: str, **want) -> dict:
    found = [line for line in table(out)
             if all(line.get(k) == v for k, v in want.items())]
    return found[0] if len(found) == 1 else {}


RENAMES = [
    ("hook_system_message", "content", "| system |"),
    ("hook_additional_context", "content", "context"),
    ("hook_blocking_error", "blockingError", "| block | agent |"),
    ("hook_non_blocking_error", "stderr", "stderr"),
    ("hook_success", "durationMs", "5482"),
    ("hook_success", "command", "context+system+stdout"),
    ("hook_cancelled", "timedOut", "timeout"),
    ("hook_permission_decision", "decision", "| 0 | - | allow |"),
    ("stop_hook_summary", "hookInfos", "| 22 |"),
    ("attachment", "toolUseID", f"| system | human | {len(DENY_TEXT)} | - | denied |"),
    ("attachment", "hookEvent", "| permission | - | 0 | - | allow |"),
]


def renamed(records: list[dict], kind: str, field: str) -> list[dict]:
    out = []
    for record in json.loads(json.dumps(records)):
        body = record.get("attachment") if isinstance(record.get("attachment"), dict) else {}
        if kind == "envelope" and field in record:
            record[f"{field}_v2"] = record.pop(field)
        elif kind == "attachment" and field in body:
            body[f"{field}_v2"] = body.pop(field)
        elif body.get("type") == kind and field in body:
            body[f"{field}_v2"] = body.pop(field)
        elif record.get("subtype") == kind and field in record:
            record[f"{field}_v2"] = record.pop(field)
        out.append(record)
    return out


def main():
    build_fixture()

    print("\n## Every fire in the session, on one line each")
    r = run()
    check("exits 0", r.returncode == 0, r.stderr)
    header = [c.strip() for c in
              next(l for l in r.stdout.splitlines() if l.startswith("| hook")).strip("|").split("|")]
    check("the columns are the join's: what fired, what it said, and what happened",
          header == ["hook", "event", "agent", "verdict", "channel", "audience", "chars",
                     "ms", "outcome"], header)

    print("\n## A gate's fire: our verdict, the harness's channel, the transcript's outcome")
    held = one(r.stdout, hook="validate-bash", agent="main", outcome="denied")
    check("the row's verdict and the harness's channel are on one line",
          [held.get(c) for c in ("event", "verdict", "channel", "audience")]
          == ["PreToolUse", "deny", "system", "human"], held)
    check("chars is the length of the text the harness recorded, not the row's guess",
          held.get("chars") == str(len(DENY_TEXT)), held)
    check("ms is `-` where the harness timed nothing: unmeasured, not instant",
          held.get("ms") == "-", held)

    print("\n## The outcome is read from the transcript, never from the verdict")
    ran = one(r.stdout, hook="validate-bash", chars=str(len(RAN_TEXT)))
    check("a deny whose tool ran anyway prints as a mismatch, on an identical row",
          ran.get("verdict") == "deny" and ran.get("outcome") == "mismatch", ran)
    check("and the sentence says which way round",
          "row says 'deny' and the tool ran" in r.stdout, r.stdout)

    print("\n## A Stop fire: three records, one line, and the turn's own fate")
    handback = one(r.stdout, hook="stop-gate", verdict="handback")
    check("the hand-back's channels are joined into one fire",
          [handback.get(c) for c in ("channel", "audience")]
          == ["context+system+stdout", "both"], handback)
    check("chars is per channel, in the channel column's order",
          handback.get("chars")
          == f"{len(HANDBACK)}+{len(HANDBACK)}+{len(HANDBACK_STDOUT)}", handback)
    check("ms is the hook's own record of itself, not the summary's rounder reading",
          handback.get("ms") == "5482", handback)
    check("a hand-back the turn continued past is a mismatch (#204)",
          handback.get("outcome") == "mismatch"
          and "hand-back continued the turn" in r.stdout, handback)

    block = one(r.stdout, hook="stop-gate", verdict="block")
    check("a block whose turn continued is the block working, not a finding",
          [block.get(c) for c in ("channel", "audience", "ms", "outcome")]
          == ["block", "agent", "900", "continued"], block)

    print("\n## not-mine and deferred get the same hand-back check (#209)")
    not_mine = one(r.stdout, hook="stop-gate", verdict="not-mine")
    check("a not-mine verdict the turn continued past is a mismatch too",
          not_mine.get("outcome") == "mismatch"
          and "not-mine continued the turn instead of ending it (#204)" in r.stdout,
          not_mine)
    deferred = one(r.stdout, hook="stop-gate", verdict="deferred")
    check("so is deferred, same rule, same line shape",
          deferred.get("outcome") == "mismatch"
          and "deferred continued the turn instead of ending it (#204)" in r.stdout,
          deferred)

    print("\n## The summary is the only record of a Stop hook that said nothing")
    silent = one(r.stdout, hook="stop-fire-log")
    check("a silent Stop fire still prints, with its verdict, duration and outcome",
          [silent.get(c) for c in ("verdict", "channel", "ms", "outcome")]
          == ["fire", "-", "22", "continued"], silent)

    killed = one(r.stdout, hook="slow-gate")
    check("a hook the harness killed prints its cancellation and the turn that ended",
          [killed.get(c) for c in ("channel", "outcome")] == ["cancelled",
                                                              "ended timeout"], killed)
    check("and is not a mismatch: a killed process owes no row",
          "slow-gate" not in "".join(l for l in r.stdout.splitlines()
                                     if l.startswith("mismatch:")), r.stdout)

    print("\n## The records that name neither hook nor command")
    permission = one(r.stdout, hook="auto-approve-permissions")
    check("a permission decision takes its name from the row it joins, and prints it",
          [permission.get(c) for c in ("channel", "audience", "chars", "outcome")]
          == ["permission", "-", "0", "allow"], permission)
    stderr = one(r.stdout, hook="post-edit-validate")
    check("a non-blocking error is the human's channel, at its own exit's cost",
          [stderr.get(c) for c in ("channel", "audience", "chars", "ms", "outcome")]
          == ["stderr", "human", str(len(STDERR_TEXT)), "3", "ran"], stderr)

    print("\n## Both directions of the join are reported")
    check("text in front of the agent that no hook logged is named",
          "the harness recorded context and no hook wrote a row for it" in r.stdout,
          r.stdout)
    check("a refusal the transcript never recorded is named",
          "row says 'deny' and the transcript holds no record of it" in r.stdout, r.stdout)
    check("the block-cap override is printed as itself, not as a fire",
          f"override: {SESSION}" in r.stdout and OVERRIDE in r.stdout, r.stdout)

    print("\n## Subagents")
    sub = one(r.stdout, hook="validate-bash", agent=AGENT, channel="system")
    check("a fire in a subagent's own file prints with its agentId",
          [sub.get(c) for c in ("verdict", "outcome")] == ["deny", "denied"], sub)

    print("\n## A subagent deny with no attachment at all (#209)")
    bare = one(r.stdout, hook="validate-bash", agent=AGENT, channel="agent")
    check("the tool_result alone names the fire, its hook, and the deny",
          [bare.get(c) for c in ("event", "verdict", "audience", "outcome")]
          == ["PreToolUse", "deny", "agent", "denied"], bare)
    check("chars is the length of the denial text the tool_result itself carried",
          bare.get("chars") == str(len(SUBAGENT_DENY_TEXT)), bare)

    solo = run("--main-only")
    check("--main-only drops it", f"| {AGENT} |" not in solo.stdout, solo.stdout)
    check("and both its rows are then refusals with no record, rather than silently gone",
          solo.stdout.count("row says 'deny' and the transcript holds no record of it") == 3,
          solo.stdout)
    anon = PROJECTS / "anon-session.jsonl"
    write_transcript(anon, [])
    write_transcript(PROJECTS / "anon-session" / "subagents" / f"agent-{AGENT}.jsonl",
                     renamed(agent_records(), "envelope", "agentId"))
    check("agentId renamed: the fire falls back to main rather than inventing an agent",
          f"| {AGENT} |" not in run(transcript=anon).stdout, run(transcript=anon).stdout)

    print("\n## A hook that self-identifies with `name:` instead of `[name]` (#209)")
    gauntlet = one(r.stdout, hook="gauntlet")
    check("gauntlet's colon-prefixed line is attributed, not left as '?'", gauntlet != {},
          r.stdout)
    check("it is still a mismatch (no row of its own) but named rather than '?'",
          "gauntlet/Stop: the harness recorded system and no hook wrote a row for it"
          in r.stdout
          and "?/Stop: the harness recorded system and no hook wrote a row for it"
          not in r.stdout, r.stdout)

    print("\n## Text with no hook name at all is grouped below the mismatches (#209)")
    check("it joins its row cleanly rather than becoming its own mismatch",
          "mystery-hook" not in "".join(l for l in r.stdout.splitlines()
                                        if l.startswith("mismatch:")), r.stdout)
    check("its first 40 characters are printed once, grouped",
          UNATTRIBUTED_TEXT[:40] in r.stdout, r.stdout)
    check("under the 'unattributed' heading, below the mismatches",
          "unattributed text(s), by their first 40 characters" in r.stdout, r.stdout)

    print("\n## A person's own decline is never mistaken for a hook's refusal (#209)")
    check("no fire, no row, no mismatch is invented for a plain user-rejected tool_result",
          USER_REJECTED_TEXT[:20] not in r.stdout, r.stdout)
    nearby = one(r.stdout, hook="validate-bash", verdict="allow")
    check("the genuinely unclaimed row beside it still prints as its own honest orphan",
          nearby.get("outcome") == "-", nearby)

    print("\n## --check is the harness form: mismatches only, nonzero on any")
    checked = run("--check")
    check("exits 1 when the two records disagree", checked.returncode == 1,
          checked.returncode)
    check("prints the mismatches and not the table",
          "| hook |" not in checked.stdout
          and checked.stdout.count("mismatch: ") == 7, checked.stdout)
    clean = run("--check", transcript=PROJECTS / f"{CLEAN}.jsonl")
    check("a session whose records agree exits 0",
          clean.returncode == 0 and "0 mismatch(es)" in clean.stdout, clean.stdout)

    print("\n## A renamed field fails here, so the schema in --help cannot go stale")
    for n, (kind, field, marker) in enumerate(RENAMES):
        check(f"{kind}.{field} feeds the output; a rename loses it",
              marker in r.stdout, f"{marker!r} missing from a clean run")
        variant = TMP / "variants" / str(n) / "-fixture" / f"{SESSION}.jsonl"
        write_transcript(variant, renamed(main_records(), kind, field))
        out = run(transcript=variant).stdout
        check(f"{kind}.{field} renamed: the reader can no longer say {marker!r}",
              marker not in out, out[:400])

    shutil.rmtree(TMP, ignore_errors=True)
    finish("All hook-trace checks passed.")


if __name__ == "__main__":
    main()
