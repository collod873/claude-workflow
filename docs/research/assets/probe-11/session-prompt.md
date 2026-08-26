Portability probe for `collod873/claude-workflow` issue #11. A setup script already ran in
this environment. Do the steps below in order and record the literal output of each. Do not
fix anything, do not install anything, and do not skip a step because an earlier one failed
— a failure is a result.

**Step 1 — where am I.** Run and record:
`whoami; echo "HOME=$HOME"; id; echo "GH_TOKEN=$GH_TOKEN"`

**Step 2 — what the setup script did.** Run and record:
`cat /tmp/probe-setup.log; echo ---; cat /tmp/probe-manifest.txt`
If both files are missing, the setup script never ran — say so plainly and stop here.

**Step 3 — is it on disk where I am.** Run and record:
`ls -la "$HOME/.claude" "$HOME/.claude/skills" 2>&1; echo ---; cat "$HOME/.claude/settings.json" 2>&1`

**Step 4 — the SessionStart hook.** Run and record:
`cat /tmp/probe-sessionstart.log 2>&1`
A missing file means the hook did not fire.

**Step 5 — the PreToolUse hook, the part that matters.** Run this Bash command:
`echo PROBE_SENTINEL_BLOCK_ME`
Exactly one of two things happens, and which one is the finding:
- the tool call is **denied** with a message containing `BLOCKED_BY_PROBE_HOOK` — the hook
  is live;
- the command **runs** and prints the sentinel — the hook was never loaded.
Record which, verbatim. Then run and record: `cat /tmp/probe-hook.log 2>&1`

**Step 6 — stop and hand back.** Print steps 1–5 as a plain summary, then say:

> Send `/probe-clean` as your next message.

Do **not** invoke `/probe-clean` or `/probe-flagged` yourself. These skills must be invoked
from a user turn: `probe-flagged` carries `disable-model-invocation: true`, so a model-side
invocation failing would prove nothing about whether the skill was loaded. Wait for the
user's message each time, and after each one record exactly what came back — the skill's
output line, or the "unknown slash command" style error.

- `/probe-clean` — expected on success: `PROBE_CLEAN_SKILL_LOADED`
- `/probe-flagged` — expected on success: `PROBE_FLAGGED_SKILL_LOADED`

After `/probe-clean`, ask for `/probe-flagged`. After `/probe-flagged`, ask the user to say
`post the report`, and then do Step 7.

**Step 7 — report.** Post a single comment on issue **#11** of `collod873/claude-workflow`
using your GitHub tools. Head it `## Setup-script portability probe — run 1` and give it
these sections, with literal command output pasted under each:

1. `Identity` — the step 1 output, and whether the setup script's HOME matched yours.
2. `Setup script log` — step 2, including the clone verdict.
3. `Skills` — the two slash-command results, one verdict line each, stating which carried
   `disable-model-invocation`.
4. `Hooks` — steps 4 and 5, saying plainly whether each fired.
5. `Environment` — whether this session was started from the phone app or a browser, and
   whether the environment's setup script was configured from a phone.
6. `Verdict` — two sentences, one for skill portability and one for hook portability. They
   may differ. Do not soften a negative; a "no" here is the useful answer.

Then stop. Do not commit anything, do not open a pull request, and do not modify the
repository.
