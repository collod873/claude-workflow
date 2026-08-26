# What a Claude cloud session can reach, and what can fire it

**Status:** §§1–8 are **read, not run** — every claim there is sourced to `code.claude.com/docs`,
**read 2026-08-21**, or to a local file inspected the same day. No routine was created and no skill
was uploaded to claude.ai. Claims the docs do not settle are marked **untested** inline and
collected in [§7](#7-what-is-still-untested).

**[§9](#9-the-setup-script-route-measured-2026-08-22-utc) is the exception: it was executed.** One
setup script, one cloud session, on 2026-08-22 UTC. Where §9 contradicts an earlier section, §9
wins — it is measurement and the rest is reading.

**Resolves:** [`collod873/claude-workflow#6`](https://github.com/collod873/claude-workflow/issues/6),
[`#11`](https://github.com/collod873/claude-workflow/issues/11)

---

## The one-line answer

**Yes — a cloud session can be fired by a repo event or a schedule, with no human in the loop.** The
mechanism is a **routine**, and it does not touch GitHub Actions minutes. The catch is not the
trigger; it is the payload: **the skill fleet does not travel by symlink or by `/converge`.** Only
three paths reach a cloud session, and the fleet as it stands today fails the cheapest of them on a
frontmatter technicality.

**Amended by [§9](#9-the-setup-script-route-measured-2026-08-22-utc), 2026-08-22 UTC:** a setup
script **is** a fourth path, measured — for skills *and* for hooks, flagged frontmatter included.
What it cannot do is fetch anything from GitHub, so it carries only what is written into the script
itself.

---

## 1. Can it be fired by something other than a human?

Yes. **Routines** are the mechanism ([`/docs/en/routines`](https://code.claude.com/docs/en/routines), read 2026-08-21):

> A routine is a saved Claude Code configuration: a prompt, one or more repositories, and a set of
> connectors, packaged once and run automatically. Routines execute on Anthropic-managed cloud
> infrastructure […] so they keep working when your laptop is closed.

Three trigger types, verbatim:

> * **Scheduled**: run on a recurring cadence like hourly, nightly, or weekly, or once at a specific
>   future time
> * **API**: trigger on demand by sending an HTTP POST to a per-routine endpoint with a bearer token
> * **GitHub**: run automatically in response to repository events such as pull requests or releases

A single routine can carry all three at once.

### What each trigger can actually do

| Trigger | Reach | Source |
|---|---|---|
| **Schedule** | Presets hourly / daily / weekdays / weekly, plus one-off at a timestamp. Custom cron via `/schedule update`. **Minimum interval is one hour** — "expressions that run more frequently are rejected." Runs are staggered a few minutes, consistently per routine. | [`/docs/en/routines#add-a-schedule-trigger`](https://code.claude.com/docs/en/routines#add-a-schedule-trigger) |
| **GitHub event** | **Two event categories only: Pull request and Release.** Within each you pick an action (`pull_request.opened`, `pull_request.closed`, …) or all actions. PR filters on author, title, body, base branch, head branch, labels, is-draft, is-merged, with equals / contains / starts-with / is-one-of / is-not-one-of / regex. | [`/docs/en/routines#supported-events`](https://code.claude.com/docs/en/routines#supported-events) |
| **API** | `POST https://api.anthropic.com/v1/claude_code/routines/<id>/fire` with a per-routine bearer token and the `experimental-cc-routine-2026-04-01` beta header. Optional freeform `text` body. Returns the new session ID and URL. | [`/docs/en/routines#trigger-a-routine`](https://code.claude.com/docs/en/routines#trigger-a-routine) |

**The gap that matters for this estate: `issues.opened` is not a supported GitHub trigger.** The
supported list is Pull request and Release, and nothing else. Lumaria's `triage.yml` fires on
`issues: types: [opened]` — a routine **cannot** replace that workflow on its own trigger surface
today. The API trigger is the escape hatch: a one-line `curl` from a tiny Actions workflow (or any
other webhook consumer) can fire a routine on any event GitHub emits, at the cost of keeping a
minimal workflow alive. **Untested** — no such relay has been built.

### The prompt is treated as a user turn, not as untrusted input

This is the point `agent-skills#8` established for Actions, now stated for routines directly:

> When a trigger fires, the session receives the routine's saved prompt as its assigned task and
> carries it out, rather than treating it as untrusted content that arrived mid-conversation.
> […] Before v2.1.213, the session received the same prompt framed as an untrusted background
> notification and could refuse to act on it.

So a routine prompt of `/wayfinder 123` is a *user* invocation, and `disable-model-invocation: true`
does not block it — that flag blocks the model choosing a skill, not a fired prompt. Consistent with
the Actions precedent already in production. **Untested against a real routine.**

And a routine runs unattended by construction:

> Routines run autonomously as full Claude Code cloud sessions: there is no permission-mode picker
> and no approval prompts during a run.

That removes the `--allowedTools` allowlist chore that `triage.yml` had to solve the hard way (see
its comment block: "Headless runs have no one to answer a permission prompt… observed: 5 turns,
4 denials, issue untouched"). It also removes the ceiling that allowlist provided.

### One-off scheduling is a real primitive

> A one-off schedule fires the routine a single time at a specific timestamp. […] After the routine
> fires, it auto-disables. […] **One-off runs do not count against the daily routine run cap.**

`/schedule in 2 weeks, open a cleanup PR that removes the feature flag` is a first-class thing to
say. That is a genuinely new shape — a deferred single edge, cheap.

---

## 2. Does it consume GitHub Actions minutes? What does it consume instead?

**No GitHub Actions minutes. None.** Cloud sessions run on Anthropic's own VMs
([`/docs/en/claude-code-on-the-web#security-and-isolation`](https://code.claude.com/docs/en/claude-code-on-the-web#security-and-isolation), read 2026-08-21): "each session runs in
an isolated, Anthropic-managed VM."

What it consumes instead, verbatim:

> **Rate limits**: Claude Code on the web shares rate limits with all other Claude and Claude Code
> usage within your account. Running multiple tasks in parallel consumes more rate limits
> proportionately. **There is no separate compute charge for the cloud VM.**
> — [`/docs/en/claude-code-on-the-web#limitations`](https://code.claude.com/docs/en/claude-code-on-the-web#limitations)

> Routines draw down subscription usage the same way interactive sessions do. In addition to the
> standard subscription limits, **routines have a daily cap on how many runs can start per account.**
> — [`/docs/en/routines#usage-and-limits`](https://code.claude.com/docs/en/routines#usage-and-limits)

The daily cap's number is not published; it is shown per-account at `claude.ai/code/routines`.
**Untested** — the actual number on this account has not been read.

Beyond the cap: with usage credits on, runs continue on metered overage; without, "additional runs
are rejected until the window resets."

### Against the alternative

The GitHub Actions path bills **both** sides ([`/docs/en/github-actions#manage-costs`](https://code.claude.com/docs/en/github-actions#manage-costs), read
2026-08-21):

> * **GitHub Actions minutes**: the Claude Code GitHub Action runs on GitHub-hosted runners, which
>   consume your GitHub Actions minutes.
> * **API tokens**: each interaction consumes tokens […] If you authenticate with an OAuth token,
>   runs use your Claude subscription instead of API billing.

So `triage.yml` today spends subscription tokens *and* runner minutes. A routine spends subscription
tokens only, plus one slot from a daily run cap. **On cost, the cloud session strictly dominates**,
which is the ruling the ticket was asking for.

Two further caps on the venue, both from the docs:

- **Resource ceilings** ([`/docs/en/cloud-environments#resource-limits`](https://code.claude.com/docs/en/cloud-environments#resource-limits)): approximately 4 vCPUs,
  16 GB RAM, 30 GB disk. Ubuntu 24.04 on x86_64.
- **GitHub webhook caps** ([`/docs/en/routines#add-a-github-trigger`](https://code.claude.com/docs/en/routines#add-a-github-trigger)): "During the research
  preview, GitHub webhook events are subject to per-routine and per-account hourly caps. Events
  beyond the limit are dropped until the window resets." A dropped event is silent. That is a
  fail-open hole of the same family as the two already logged in `INDEX.md §7`, and it is
  structural, not fixable from this side.

---

## 3. Skill portability: does the fleet reach a cloud session?

**Not as it stands.** The docs are unambiguous ([`/docs/en/skills#skills-in-cowork-and-cloud-sessions`](https://code.claude.com/docs/en/skills#skills-in-cowork-and-cloud-sessions),
read 2026-08-21):

> Cowork sessions and cloud sessions, **including routines, don't read `~/.claude/skills/` on your
> machine.** […] If a skill exists only in `~/.claude/skills/` on your machine, Claude Code reports
> that the skill was not found when a routine invokes it, because each routine run starts as a fresh
> remote session.

That is the same failure `triage.yml` guards against in its own words — "A machine-global skill
symlink is not visible to the runner" — restated by Anthropic for a venue where the guard does not
exist. `triage.yml` at least fails loudly with `::error::`; a routine invoking a missing skill just
reports "skill not found" mid-run, and the run list still shows green:

> A green status in the run list means the session started and exited without an infrastructure
> error. It does not mean the task in your prompt succeeded.

### The three supported paths

Same doc section, verbatim:

> * For Cowork and cloud sessions, enable the skill for your claude.ai account.
> * For cloud sessions, you can instead commit the skill to the repository's `.claude/skills/`, or
>   ship it in a plugin declared in the repository's `.claude/settings.json`.

| Path | What it costs | Verdict for this fleet |
|---|---|---|
| **A. Enable on claude.ai** | Upload each skill to the claude.ai account; cloud sessions load them with zero per-repo work | Cheapest by far — **but blocked today, see below** |
| **B. Commit to `.claude/skills/`** | Vendoring copies into every consumer repo | Works, and is exactly what `triage.yml` already does; N copies to keep in sync |
| **C. Plugin declared in repo `.claude/settings.json`** | Publish `agent-skills` as a plugin marketplace; declare it per repo | One source of truth, per-repo one-line declaration. Requires network access to the marketplace at session start. **Untested** |

### Why path A is blocked today — a hard number

Uploading to claude.ai enforces the Agent Skills spec's six-field frontmatter
([`/docs/en/skills#using-skill-frontmatter-outside-claude-code`](https://code.claude.com/docs/en/skills#using-skill-frontmatter-outside-claude-code)):

> | claude.ai skill uploads, the Skills API, and packaging with `package_skill.py` […] | `name`,
> `description`, `license`, `compatibility`, `metadata`, `allowed-tools` |
>
> When you enable a personal skill for Cowork and cloud sessions, **including routines, you upload
> it to claude.ai, so the same rules apply.** […] If you include any field the spec doesn't allow,
> **packaging or upload fails with a hard error** instead of ignoring the field.

Measured against `~/.agents/skills` on 2026-08-21 (44 skill directories with a `SKILL.md`):

- **22 skills carry `disable-model-invocation:`** — not a spec field.
- **4 skills carry `argument-hint:`** — not a spec field.

**Exactly half the fleet fails upload on frontmatter alone**, including every one of the ten
pipeline verbs, which are `disable-model-invocation: true` by design (`INDEX.md §1`). Stripping the
field to pass upload is not cosmetic: it re-arms model invocation for the whole pipeline, which is
the property `agent-skills#128` is currently arguing about. There is a settings-side substitute —
`skillOverrides: "user-invocable-only"` — but it lives in a settings file, which for a cloud session
means the **repo's** `.claude/settings.json`, per repo. **Untested.**

### The good news on path A, if the frontmatter is fixed

Synced skills are not degraded in the cloud
([`/docs/en/skills#how-claude-code-handles-the-body-of-a-synced-skill`](https://code.claude.com/docs/en/skills#how-claude-code-handles-the-body-of-a-synced-skill)):

> **In a cloud session, the body keeps the behavior a local skill has**, because the session runs in
> an isolated container.

So `` !`command` `` injection, `@` file references, and `${CLAUDE_PROJECT_DIR}` all still work —
unlike a synced skill in a local session, where they arrive as literal text. Only 2 of the 44 skills
use those features, so this is a small win, but it means path A is not a lobotomised copy.

### The hooks are a harder no

> **Overturned by [§9](#9-the-setup-script-route-measured-2026-08-22-utc), 2026-08-22 UTC.** Hooks
> written to `~/.claude/settings.json` by the environment's own setup script **do** fire in a cloud
> session, and do block. Everything below is correct about the *machine's* `~/.claude/settings.json`
> and about the per-repo route; it is wrong that those are the only two. Read §9 before using this
> section for the venue ruling.

There is no claude.ai sync for hooks, only for skills. `/docs/en/hooks` (read 2026-08-21):

> Cloud sessions on Claude Code on the web don't read your local `~/.claude/settings.json`; hooks
> there come from the repo and from your organization's server-managed settings.

And `/docs/en/cloud-environments#setup-scripts-vs-sessionstart-hooks` repeats it:

> If you have SessionStart hooks in your user-level `~/.claude/settings.json`, don't expect them in
> the cloud: user-level settings stay on your machine. In a cloud session, Claude Code runs hooks
> from the repository and from your organization's server-managed settings.

**Consequence: `close-gate.py` does not run in a cloud session unless the consumer repo commits it.**
Lumaria already does (18 hook files, `$CLAUDE_PROJECT_DIR`-relative). This repo and `agent-skills`
do not. A routine that closes a ticket in a repo with no committed close-gate closes it with **no
verification record enforced at all** — the gate is not merely absent, it is absent invisibly. That
is the single largest safety finding here, and it is a precondition on any routine that closes work,
not a nice-to-have.

The remaining option is **server-managed settings** — an organization-level delivery of hooks that
does reach cloud sessions. Personal Pro/Max accounts are not organizations. **Untested; likely not
available on this account.**

---

## 4. Is a setup script running `/converge` a supported way to install `~/.agents/skills`?

**No, on two independent grounds.** Neither is a matter of degree.

### Ground 1 — a setup script cannot invoke a skill

A setup script is plain Bash that runs *before Claude exists*
([`/docs/en/cloud-environments#setup-scripts`](https://code.claude.com/docs/en/cloud-environments#setup-scripts), read 2026-08-21):

> A setup script is a Bash script that **runs when a new cloud session starts, before Claude Code
> launches.** […] Scripts run as root on Ubuntu 24.04.

Ordering is explicit: "The setup script runs first, before Claude Code launches" — then "Claude Code
launches and runs your SessionStart hooks." There is no agent in the setup-script phase to receive
`/converge`. The skill is a prompt, not a program.

### Ground 2 — `/converge` would not survive the environment even if it could run

Reading `~/.agents/skills/converge/SKILL.md` (2026-08-21), its six steps against a cloud VM:

| Step | Fate in a cloud session |
|---|---|
| 1. Seed — `chezmoi update` from `collod873/dotfiles` | chezmoi is not pre-installed; would need `apt`/binary install. Then it writes a full dotfile tree onto a throwaway VM for one run |
| 2. Payloads — clone `agent-skills` to `~/.agents/skills` | **The only step that is both possible and wanted.** Two lines of Bash |
| 3. Strays — reconcile against `chezmoi managed`, archive leftovers, "ask the user" when unsure | Fresh VM: no strays exist. And the step is interactive by design; nothing can answer |
| 4. Repos — `gh repo list --limit 200`, clone every repo into `~/Claude Projects` | `gh` is not pre-installed; the session already has its repo cloned; cloning the whole estate onto a 30 GB disk is wrong |
| 5. Nightly sync — install a launchd job or crontab entry | The VM is reclaimed after inactivity. A nightly backup job on an ephemeral VM is meaningless |
| 6. Auth — `gh auth login`, `gwsa-login` | Explicitly interactive ("Logins are interactive"). Cloud sessions cannot do browser auth: "Interactive auth like AWS SSO — **No.** Not supported" |

`converge/SKILL.md` also carries `disable-model-invocation: true` and gates on a seeded machine
("No chezmoi or no skills on this machine yet? It isn't seeded — hand the user FRESH-MACHINE.md and
stop") — a fresh cloud VM hits exactly that stop condition on the first line.

**`/converge` is a verb for a durable machine.** A cloud VM is not another machine to converge; it is
a fresh container with a repo in it. Converging one is a category error, not an engineering gap.

### What a setup script *could* legitimately do — and what would still be missing

Step 2 in isolation looks like a fine setup script:

```bash
#!/bin/bash
git clone --depth 1 https://github.com/collod873/agent-skills /opt/agent-skills || true
```

**Corrected by [§9](#9-the-setup-script-route-measured-2026-08-22-utc), 2026-08-22 UTC — it does not
work.** Run for real, that clone fails with `could not read Username for 'https://github.com'`: the
setup phase holds no GitHub credentials and has no TTY to prompt on, and `agent-skills` is private.
The `|| true` hides it. Everything below in this section assumed the clone succeeds; read it against
§9.

The environment cache keeps it, so it runs once per ~7 days rather than per session
([`/docs/en/cloud-environments#environment-caching`](https://code.claude.com/docs/en/cloud-environments#environment-caching)).

**What would still be missing after that clone, even if it succeeds:**

1. **Whether Claude Code in a cloud session reads a VM-local `~/.claude/skills/` at all.** The docs
   say cloud sessions "don't read `~/.claude/skills/` **on your machine**" — the stated reason is
   always that the files live on your laptop, never that the path is ignored. Whether a
   root-written `/root/.claude/skills` is even the right `HOME` for the user Claude Code runs as is
   also unstated. ~~**Untested, and this is the load-bearing unknown for the whole setup-script
   route.**~~ **Ran it — [§9](#9-the-setup-script-route-measured-2026-08-22-utc). It reads. Both
   phases are `root` with `HOME=/root`, so it is the right home too.**
2. ~~**The hook fleet.** No path.~~ **Wrong — [§9](#9-the-setup-script-route-measured-2026-08-22-utc)
   fired both a SessionStart and a PreToolUse hook from a setup-script-written
   `~/.claude/settings.json`, and the PreToolUse hook denied a tool call rather than merely logging
   it.** The sentence below is right about the *clone*, though, and for a reason it did not
   anticipate: the clone fails outright, so nothing on disk comes from `agent-skills` at all.
3. **Everything `~/bin` provides** — `file-issue`, `publish-issue-graph`, `lint`, `re-seed`. Also
   only in the clone, also not on `PATH` unless the script puts it there. Anything shelling out to
   `gwsa` or `reddit-search` needs credentials, and there is no secrets store: "A dedicated secrets
   store is not yet available."
4. **`gh` itself.** Not pre-installed. The built-in GitHub tools cover issues/PRs/diffs/comments,
   but `gh release`, `gh workflow run`, and `gh issue edit --add-assignee` style calls need
   `apt install -y gh` in the setup script. Note `GH_TOKEN` reads as the literal placeholder
   `proxy-injected` when the GitHub proxy is authenticating — **a script that reads `GITHUB_TOKEN`
   directly gets the placeholder, not a usable token.**

~~**Ruling: the supported way to get the fleet into a cloud session is path A or C from §3 — not a
setup script, and never `/converge`.**~~ **Amended by
[§9](#9-the-setup-script-route-measured-2026-08-22-utc), 2026-08-22 UTC.** A setup script *is* a
working path for both skills and hooks — it is the only path hooks have outside a per-repo commit.
The half of this ruling that survives is `/converge`: never. And the reason the setup-script path is
still not sufficient on its own is delivery, not capability — it carries only what is typed into the
script, because it cannot reach GitHub.

---

## 5. The two lenses the handoff never separated

The handoff named two uses and answered neither. They are different questions with, as it turns out,
the same answer.

### Lens 1 — grilling with no repo access

*"Stress-test this idea"* needs a model and a conversation. It does not need a working tree.

A cloud session cannot be started without a repository — the mobile flow is "select a repository and
branch, describe the task" ([`/docs/en/mobile#start-and-monitor-cloud-sessions`](https://code.claude.com/docs/en/mobile#start-and-monitor-cloud-sessions), read 2026-08-21),
and a routine's form requires "one or more GitHub repositories." But that is a formality, not an
obstacle: point it at any small repo and the session ignores the tree. The real constraints are
elsewhere:

- **`/grilling` lives only in `~/.agents/skills`**, so it does not reach the cloud today, by §3.
  Typing `/grilling` in a cloud session gets "skill not found."
- **Correction, 2026-08-21:** an earlier revision of this line claimed `/grilling` carries
  `disable-model-invocation: true`. It does not. Measured against `~/.agents/skills`: `grilling`
  (name + description only) and `domain-modeling` are both **spec-clean** and upload to claude.ai
  today with no frontmatter edit. The flagged neighbours are `grill-me` and `grill-with-docs` — and
  `grill-with-docs` is a 7-line wrapper whose entire body delegates to those two clean skills. §3's
  broader claim, that every one of the ten *pipeline verbs* carries the flag, is correct and
  unaffected.
- Grilling is a **conversation**, and a cloud session is a good conversational surface — it persists
  with the browser closed, and the mobile app is a first-class client. It also needs **no hooks**,
  which matters because hooks have no route to a cloud session but a per-repo commit (§3).

**Verdict: path A works for this lens today.** Uploading `grilling` and `domain-modeling` to
claude.ai needs no code change, no repo commit and no setup script — so the phone grilling lens is
**not blocked**, and it does not wait on the fleet-portability question in §7.1. What remains
blocked is the *pipeline* half of the fleet, which is a different lens with a different answer.

### Lens 2 — asking live state ("why is #704 blocked")

This one the venue serves natively, with zero setup
([`/docs/en/cloud-environments#work-with-github-issues-and-pull-requests`](https://code.claude.com/docs/en/cloud-environments#work-with-github-issues-and-pull-requests), read 2026-08-21):

> Cloud sessions include built-in GitHub tools that let Claude **read issues, list pull requests,
> fetch diffs, and post comments without any setup.** These tools authenticate through the GitHub
> proxy […] so your token never enters the container.

And the reach is wider than the selected repo
([`/docs/en/claude-code-on-the-web#github-authentication-options`](https://code.claude.com/docs/en/claude-code-on-the-web#github-authentication-options)):

> With either method, a cloud session can access **any repository the connecting GitHub account can
> see**, not just the repositories the Claude GitHub App is installed on.

So "why is #704 blocked" is answerable from a cloud session started against an unrelated repo, on a
phone, with no skills installed and no setup script, today.

### Does one surface serve both?

**Yes — a cloud session serves both, and it is the only surface that does.**

| | Grilling (no repo needed) | Live state (#704) | Machine must stay on |
|---|---|---|---|
| **Cloud session** | Yes, once the skill travels | **Yes, today, zero setup** | **No** |
| Remote Control | Yes — carries every skill for free | Yes — it is the local terminal | **Yes** |
| GitHub Actions | Poorly — no conversation, one shot | Yes, with `gh` allowlisted | No, but burns minutes |

Remote Control is not a competitor for this: it is a window onto the local terminal, so it inherits
the full fleet at no cost but offloads nothing and requires the machine awake
([`/docs/en/cloud-environments`](https://code.claude.com/docs/en/cloud-environments): "Remote Control sessions connect the web and mobile interfaces to a
session on your own machine, which uses your machine's network and files, not a cloud environment").
It is the right answer when the work needs local files and the wrong answer when the laptop is shut.

The two lenses do **not** pull in different directions. They pull in the same direction, and the one
thing standing between them and a working surface is §3.

---

## 6. Corrections to the ticket's "what is already known"

- **"44 symlinks into `~/.agents/skills/`"** — close but imprecise. Measured 2026-08-21:
  `~/.claude/skills/` holds **41 symlinks**, `~/.agents/skills/` holds **44 directories containing a
  `SKILL.md`**. The three unlinked entries are `bin/`, `docs/`, and `hooks/` — payload directories,
  not skills. The fleet is 44 skills; the symlink count is 41.
- **"`/plugin`, `/resume`, `/clear` do not exist in cloud sessions"** — confirmed
  ([`/docs/en/claude-code-on-the-web#manage-context`](https://code.claude.com/docs/en/claude-code-on-the-web#manage-context), read 2026-08-21). Also worth knowing:
  `/model`, `/effort`, `/fast`, `/color`, `/rename` work but require the value as an argument
  (`/model sonnet`), and `/config` on the web opens a settings panel and ignores `key=value`. `/schedule`
  itself is unavailable **inside** a cloud session — "You are inside a Claude Code on the web
  session. Manage routines from the web UI instead."
- **"Cloud environments support setup scripts"** — confirmed, but see §4: they run as root, before
  Claude launches, must exit zero (non-zero fails the session), must finish in ~5 minutes, and are
  skipped entirely when a cached environment exists.
- **Not previously noted:** subagents work normally in cloud sessions and `.claude/agents/` is
  picked up automatically; agent teams are off unless
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in the environment. The checker-by-stub pattern
  (ADR-0026) therefore transfers, provided the checker's own instructions travel with it —
  `CHECKER-PROMPT.md` lives in `~/.claude/hooks/`, so today it does not.

---

## 7. What is still untested

Every item here is a claim the primary docs do **not** settle. None of it has been run.

1. ~~**Does a cloud session read a `~/.claude/skills/` *and a `~/.claude/settings.json`* written by
   its own setup script?**~~ **Answered by measurement — see
   [§9](#9-the-setup-script-route-measured-2026-08-22-utc). Yes to both.** What replaced it as the
   open question is narrower and is stated there: not *whether* the route reads, but *what the
   script can put on the wire*, since it holds no GitHub credentials.
2. **Whether `disable-model-invocation` survives being stripped for upload** without re-arming model
   invocation across the pipeline — and whether repo-level `skillOverrides` is an adequate
   substitute. §3.
3. **The daily routine run cap on this account.** Number not published; shown at
   `claude.ai/code/routines`. §2.
4. **The per-routine and per-account hourly webhook caps.** Also unpublished, and events past them
   are dropped silently. §2.
5. **Whether a routine's fired prompt really does reach a `disable-model-invocation: true` skill.**
   The docs say the prompt is an assigned task rather than untrusted content, and the Actions
   precedent (`agent-skills#8`) says the same for a comparable path — but no routine has been run
   against one of these skills. §1.
6. **Whether an Actions-to-`/fire` relay is a sane way to get `issues.opened` coverage**, given
   routines support only Pull request and Release events. §1.
7. **Whether path C (marketplace plugin) works** for `agent-skills`, and what publishing it as a
   marketplace costs. §3.
8. **Server-managed settings** as a hook-delivery route — presumed unavailable on a personal
   Pro/Max account, not confirmed. §3.

---

## 8. What this means for the venue ruling

The premise in the ticket holds: **cloud sessions are the cheapest agent venue on the board** —
Anthropic-hosted VMs, no GitHub minutes, drawing on rate limits already paid for, with a daily run
cap as the only new currency. The trigger question is answered yes.

But the ruling should carry three riders, none of them small:

1. **The fleet does not travel by any mechanism this estate currently uses.** Not symlinks, not
   `/converge`. Getting it there is real work — either uploading a frontmatter-corrected fleet to
   claude.ai, or vendoring per repo the way `triage.yml` already does, or publishing a marketplace.
   **Amended 2026-08-22 UTC ([§9](#9-the-setup-script-route-measured-2026-08-22-utc)):** a setup
   script is a fourth mechanism and it works, flagged frontmatter and all — but it reaches no
   GitHub credentials, so it carries only what is typed into the script itself.
2. ~~**The hook layer has no cloud path outside a consumer repo's own `.claude/`.**~~ **Rewritten
   2026-08-22 UTC ([§9](#9-the-setup-script-route-measured-2026-08-22-utc)).** A setup script can
   deliver working, blocking hooks, so a cloud venue is not condemned to close work ungated. But
   the payload lives in a textarea in account settings rather than in git — unversioned,
   unreviewable, and undetectably stale — and `close-gate.py` is a multi-file package the script
   cannot clone. So the rider stands with its reason changed: **the enforcement layer has a route,
   and no maintainable way to send it down that route yet.** Given `INDEX.md §8`'s standing finding
   that enforcement at execution time is the only thing that survives, the venue ruling has to pick
   between a plaintext PAT in environment settings and committing the hooks per repo — it cannot
   inherit the question.
3. **`issues.opened` is not a routine trigger.** The one CI-driven edge this estate actually runs
   today cannot move to a routine without an API-trigger relay.

---

## 9. The setup-script route, measured (2026-08-22 UTC)

**Resolves:** [`#11`](https://github.com/collod873/claude-workflow/issues/11). Full run log with
verbatim command output:
[issue #11, comment 5377211001](https://github.com/collod873/claude-workflow/issues/11#issuecomment-5377211001).

Method: one throwaway cloud environment (`probe-11`, network **Trusted**, no environment variables),
whose setup script attempted to clone `agent-skills` and — independently — wrote two probe skills
and a two-hook `settings.json` into every plausible home by heredoc. One cloud session against
`collod873/claude-workflow` on `main`, started from claude.ai on the web. Both slash commands were
sent as **user turns**, never model-side, because `disable-model-invocation` suppresses model-side
invocation by design and a model-side failure would have proved nothing.

### The answer

| Question | Result |
|---|---|
| Does the session read `~/.claude/skills/` written by its own setup script? | **Yes** |
| Does it read `~/.claude/settings.json` written by its own setup script? | **Yes** |
| Does a skill carrying `disable-model-invocation: true` survive the route? | **Yes** |
| Do hooks declared there actually fire — and actually block? | **Yes, and yes** |
| Can the setup script fetch the fleet from GitHub? | **No** |

**Skills.** `/probe-clean` and `/probe-flagged` both loaded from `/root/.claude/skills/` and emitted
their sentinel lines. The flagged one behaved exactly as specified: **absent from the model-visible
skills list, fully available to the user's slash command.** So the route carries the pipeline verbs
without the frontmatter surgery §3 said path A demands — `disable-model-invocation` is not a field
this path validates against, because nothing is uploaded to claude.ai.

**Hooks.** SessionStart fired at session open. PreToolUse intercepted **every** Bash call in the
session and **denied** the sentinel — `BLOCKED_BY_PROBE_HOOK`, sentinel never printed. That is the
half §3 called a hard no. It is not a no.

### Identity: the two phases share a user, and do not share an environment

The setup script logged `whoami=root HOME=/root`; the session logged `root`, `HOME=/root`. Same user,
same home, **directly observed on both sides** — not inferred. The probe hedged its own finding here
on the grounds that the script wrote to all four candidate homes (`/root`, `/home/claude`,
`/home/ubuntu`, `/home/user`) so a hit was guaranteed; that caveat is weaker than it reads. The
shotgun means the run never isolated *whether writing only to `/root` suffices*, but both phases
printing `/root` settles which home is the live one. The residual risk is that the image changes,
not that the finding is ambiguous.

What the two phases genuinely do **not** share is the environment block: `GH_TOKEN` and
`GITHUB_TOKEN` both read `unset` during setup, while `GH_TOKEN` is set (14 characters) in the
session. **Environment variables do not survive from the setup phase into the agent phase.** The
filesystem does; the environment does not. That asymmetry is the whole mechanism — the route works
precisely because it is a filesystem snapshot.

### What the script cannot do: reach GitHub

`git clone --depth 1 https://github.com/collod873/agent-skills` died with:

```
fatal: could not read Username for 'https://github.com': No such device or address
```

**The setup script holds no GitHub credentials and has no TTY to prompt on.** The GitHub proxy that
authenticates the *session's* built-in tools does not cover a raw `git clone` in the setup phase, and
`agent-skills` is private. §4's suggested two-line setup script — `git clone … /opt/agent-skills` —
**does not work as written**; correct it there.

Two ways round it, both with a price:

- **A `GH_TOKEN` environment variable** on the environment. The docs are explicit that a token set
  this way "passes through to the container unchanged" and is "readable by anyone who uses the
  environment." That is a long-lived PAT sitting in plaintext account configuration, and it is the
  only thing standing between the route and the whole fleet.
- **A public mirror.** Ruled out — going public is a standing owner decision (map Notes), and
  `gist.githubusercontent.com` is not on the default allowlist even for a secret gist, though
  `raw.githubusercontent.com` is.

### What this costs to maintain

The route's payload lives **in a textarea in account settings, not in git.** Nothing about that is
recoverable by the pipeline: no diff, no review, no CI, no `git log`, and no way for a session to
detect that the copy it is running is stale.

- **Nobody reruns the script by hand.** It re-runs when the script text changes, when the allowed
  hosts change, or when the ~7-day environment cache expires. So a bad edit propagates silently on
  the next cache build, and a good edit does not take effect until one.
- **"What happens when `agent-skills` moves"** is currently *nothing*, because the clone never
  worked. Add the PAT and the answer inverts: the script breaks on the next cache build, in a
  textarea nobody is watching.
- **It is per-environment, not per-repo.** That is the real win over committing hooks to each
  consumer repo — one environment covers every session that runs in it, across repos. It is also
  the real risk: one edit changes the enforcement layer for everything at once.

### Consequence for the venue ruling

**§3's "the hooks are a harder no" is overturned, and §8's rider 2 needs rewriting.** Hooks have a
second delivery route to a cloud venue, so a routine closing a ticket in a repo with no committed
`close-gate.py` is no longer *necessarily* ungated. The third fail-open hole has a fix.

But the fix is narrower than the mechanism suggests, and the gap is delivery, not capability.
`close-gate.py` is not a single file — it sits on `_hook.py`, `_harness.py` and
`CHECKER-PROMPT.md` in `~/.agents/skills/hooks/`. Inlining a multi-file Python package into a web
textarea by heredoc is not a maintainable delivery mechanism for the enforcement layer, and the
clone that would make it one needs the PAT above.

So the honest statement for the ADR: **the mechanism is proven and the payload delivery is not.**
A cloud venue can be gated. Gating it today means either a plaintext PAT in environment settings, or
committing the hooks per repo after all — and the choice between those two is a ruling
[#9](https://github.com/collod873/claude-workflow/issues/9) has to make, not inherit.

### Two things observed in passing

- **`~/.claude/skills/synced/` appears after the setup phase**, not during it — the setup manifest
  does not list it and the in-session `ls` does. That is where claude.ai-uploaded skills land, so
  **path A and the setup-script route coexist in the same directory** rather than competing.
- **A second gate is live in cloud sessions on `auto` permission mode.** The probe's step-1 command
  was denied by Claude Code's own permission classifier ("Blocked by classifier") for echoing a
  token value — independently of, and in addition to, the probe hook, which the hook log shows
  fired on the same call. Worth knowing before writing a routine prompt that shells out to anything
  credential-shaped.
