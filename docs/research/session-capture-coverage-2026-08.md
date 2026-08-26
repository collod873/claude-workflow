# The SessionEnd matcher has cost the corpus one empty session, and the recorder's start date cost it 589

**Surveyed:** 2026-08-26 · **Status:** measured ·
**Researches:** [claude-workflow#103](https://github.com/collod873/claude-workflow/issues/103) §3

#103 §3 asked how much of the corpus's missing half is the recorder's start date and how much is the
`clear|logout|other` matcher declining to fire. It is not a close call: **589 of 594, and one.**

## The split

Measured against the corpus as it stood at `Knowledge-Base@5a4df95`, the last commit before the
backfill — the pre-backfill state is what the question is about, and git still holds it.

| | Sessions |
|---|---|
| Real transcripts under `~/.claude/projects/` (excluding `-tmp-` scratch) | 635 |
| Captured before the backfill, by the live hook | 41 |
| Ended **before** the recorder went live — nothing could have captured them | 589 |
| Ended **after**, and captured | 41 of 46 |
| Ended after, uncaptured, **still running at the time of measurement** | 4 |
| Ended after, uncaptured, genuinely ended | **1** |

The recorder's first live capture ends at **2026-08-25T23:07:47Z**. Every one of the 589 predates it.
That is the whole of the gap #103 §2 closed, and it is a start-date problem, not a matcher problem.

## The one session the matcher declined

`d24ee4e7`, ended 2026-08-26T00:16:40Z, in `Claude Projects/Lumaria`. **Seven lines long, and not
one of them is a human turn:**

```
mode | bridge-session | file-history-snapshot | user (<local-command-caveat>) |
user (<command-name>/clear</command-name>) | system | cost-state
```

It is the stub session `/clear` opens behind the session it closes. The clear it records is the same
event that captured `7a36ccaa` one second earlier — `~/.claude/session-capture.log` carries
`2026-08-26T00:16:40Z captured 7a36ccaa-...` and nothing for `d24ee4e7`. The stub was then abandoned
at the prompt and ended by a reason the matcher does not list.

**So the matcher is right and does not change.** `.claude/hooks/session-capture.sh`'s header argues
that an aborted prompt is not a session that ended; the one session that argument has cost the
corpus contains no conversation at all. Capturing it would have produced a file with an empty
`## Exchange`.

**What this does not establish.** One session is not a rate. The measurement covers the six days the
recorder has existed, in which no session ended by `logout` either — 34 of the 41 live captures were
`clear`, 7 `other`, 0 `logout`. If a later count shows abandoned-at-the-prompt sessions carrying real
conversation, this is the note that gets amended.

## The commands

Pre-backfill capture set and the matcher reason each one carries:

```sh
cd ~/'Claude Projects/Knowledge-Base'
for f in $(git ls-tree -r --name-only 5a4df95 raw/sessions | grep '\.md$'); do
  git show "5a4df95:$f" | sed -n '5p'
done | sort | uniq -c | sort -rn
#  839 source: session-end   ← the era-6 recorder, retired
#   34 source: clear
#    7 source: other
#    2 source: wrap-up
```

The split itself — every real transcript's last `timestamp`, bucketed against the recorder's start:

```sh
python3 - <<'EOF'
import os, json, subprocess
kb = os.path.expanduser("~/Claude Projects/Knowledge-Base")
files = subprocess.run(["git","-C",kb,"ls-tree","-r","--name-only","5a4df95","raw/sessions"],
                       capture_output=True, text=True).stdout.split()
live = set()
for f in (f for f in files if f.endswith(".md")):
    body = subprocess.run(["git","-C",kb,"show",f"5a4df95:{f}"], capture_output=True, text=True).stdout
    src = [l for l in body.split("\n")[:8] if l.startswith("source: ")]
    if src and src[0].split(": ")[1] in ("clear","logout","other"):
        live.add(f[-11:-3])

def last_ts(path):
    last = None
    for line in open(path, errors="replace"):
        if '"timestamp"' not in line: continue
        try: d = json.loads(line)
        except Exception: continue
        if isinstance(d.get("timestamp"), str): last = d["timestamp"]
    return last

base = os.path.expanduser("~/.claude/projects")
rows = [(f[:8], last_ts(os.path.join(base,d,f)), d)
        for d in sorted(os.listdir(base)) if os.path.isdir(os.path.join(base,d)) and not d.startswith("-tmp-")
        for f in sorted(os.listdir(os.path.join(base,d))) if f.endswith(".jsonl")]
start = min(t for s,t,_ in rows if s in live and t)
after = [r for r in rows if r[1] and r[1] >= start]
print("recorder live at", start)
print("before:", len(rows)-len(after), "· after:", len(after), "· after and captured:", sum(1 for r in after if r[0] in live))
for r in sorted((r for r in after if r[0] not in live), key=lambda r: r[1]): print("  uncaptured:", *r)
EOF
```

The four "still running" rows are identified by transcript mtime falling inside the minute the
measurement ran — re-running this note's script later will show them captured, and the count of
genuinely-ended-and-uncaptured sessions unchanged at one.
