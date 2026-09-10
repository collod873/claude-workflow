#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path

import _hook

HOOKS_DIR = Path(__file__).resolve().parent
ROSTER_PATH = HOOKS_DIR / "roster.json"
HOOK_TIMEOUT_SECONDS = 300
TRACEBACK_MARKER = b"Traceback (most recent call last):"


def roster() -> dict:
    return json.loads(ROSTER_PATH.read_text())


def argv_for(hook_path: Path) -> list[str]:
    if hook_path.suffix == ".py":
        return [sys.executable, str(hook_path)]
    return [str(hook_path)]


def run_one(name: str, stdin_bytes: bytes, env: dict) -> tuple[str, int, bytes, bytes]:
    path = HOOKS_DIR / name
    if not path.is_file():
        return name, 1, b"", f"{name}: no such hook file\n".encode()
    try:
        proc = subprocess.run(argv_for(path), input=stdin_bytes, capture_output=True,
                              env=env, timeout=HOOK_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        return name, 1, b"", f"{name}: exceeded its {HOOK_TIMEOUT_SECONDS}s dispatcher timeout\n".encode()
    except OSError as exc:
        return name, 1, b"", f"{name}: could not run ({exc})\n".encode()
    return name, proc.returncode, proc.stdout, proc.stderr


def merge_stdouts(parts: list[bytes]) -> bytes:
    merged: dict = {}
    text_parts: list[bytes] = []
    any_json = False

    def absorb(target: dict, key, value) -> None:
        if key == "additionalContext" and isinstance(value, str):
            if isinstance(target.get(key), str):
                target[key] = target[key] + "\n" + value
            else:
                target[key] = value
        elif key not in target:
            target[key] = value

    for raw in parts:
        stripped = raw.strip()
        if not stripped:
            continue
        try:
            doc = json.loads(stripped)
        except (json.JSONDecodeError, UnicodeDecodeError):
            doc = None
        if not isinstance(doc, dict):
            text_parts.append(raw.rstrip(b"\n"))
            continue
        any_json = True
        for key, value in doc.items():
            if key == "hookSpecificOutput" and isinstance(value, dict):
                existing = merged.setdefault("hookSpecificOutput", {})
                if not isinstance(existing, dict):
                    continue
                for k2, v2 in value.items():
                    absorb(existing, k2, v2)
            else:
                absorb(merged, key, value)

    if any_json:
        out = json.dumps(merged).encode()
        if text_parts:
            out += b"\n" + b"\n".join(text_parts)
        return out
    return b"\n".join(text_parts)


def is_broken(code: int, err: bytes) -> bool:
    return code not in (0, 2) or TRACEBACK_MARKER in err


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: dispatch.py <Event>", file=sys.stderr)
        return 2

    event = argv[0]
    stdin_bytes = _hook.read_stdin_bytes()
    names = roster().get(event, [])
    env = dict(os.environ)

    results = [run_one(name, stdin_bytes, env) for name in names]

    exit2 = [r for r in results if r[1] == 2]
    if exit2:
        sys.stderr.buffer.write(b"".join(r[3] for r in exit2))
        return 2

    broken = [r for r in results if is_broken(r[1], r[3])]
    clean_stdouts = [r[2] for r in results if r[1] == 0 and not is_broken(r[1], r[3])]
    merged = merge_stdouts(clean_stdouts)
    if merged:
        sys.stdout.buffer.write(merged)

    if broken:
        sys.stderr.buffer.write(b"".join(r[3] for r in broken))
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
