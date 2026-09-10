---
name: converge
description: Converge this machine to the GitHub backups: fresh-machine setup or drift repair (dotfiles, skills, repos, nightly sync, auth).
disable-model-invocation: true
---

# Converge

Make this machine match the backups, then prove it. Idempotent: run on a fresh machine, after a restore, or whenever skills or config look wrong. The backups: `collod873/dotfiles` (chezmoi: `~/.claude`, `~/bin`, shell) and `collod873/agent-skills` (payload behind the skill symlinks).

No chezmoi or no skills on this machine yet? It isn't seeded, so hand the user [FRESH-MACHINE.md](FRESH-MACHINE.md) and stop.

Platform: `uname`. Darwin is mac; Linux with `microsoft` in `/proc/version` is WSL. Native Windows: steer to WSL via FRESH-MACHINE.md (`~/bin` is bash; symlinks need Developer Mode).

## 1. Seed

`chezmoi update` (pull + apply). Source remote must be `collod873/dotfiles`.

Done when: `chezmoi status` prints nothing.

## 2. Payloads

Chezmoi carries symlink pointers, not their targets. Clone `collod873/agent-skills` to `~/.agents/skills` (pull if present).

Done when: zero broken symlinks under `~/.claude/skills`.

## 3. Strays

Chezmoi never deletes unmanaged files, so leftovers linger and load as stale skills and hooks. Find every entry under `~/.claude/{skills,hooks,commands,agents,lib}` and `~/bin` that is neither in `chezmoi managed` nor matched by `.chezmoiignore`, then sort it:

- Broken symlink → dead pointer: delete.
- Real file older than the last dotfiles commit → leftover: archive to `~/.claude/archive/strays-<date>.tar.gz`, then delete.
- Real file newer than the last dotfiles commit → likely the user's fresh work: `chezmoi add` it. Unsure → ask, showing the file and both fates.

Done when: every remaining entry is managed or ignore-listed.

## 4. Repos

`gh repo list --limit 200`. Special homes: `dotfiles` is the chezmoi source (already seeded); `agent-skills` is `~/.agents/skills`. Every other repo clones into the projects root if missing; root is `~/Claude Projects` (create it). For repos already local: origin must be set and the branch pushed, since a repo with no remote is silently unbacked. Wire it to its GitHub twin only after `git fetch` shows shared history; unrelated histories get reported, not merged.

Done when: every GitHub repo has a local clone and every local project repo has a pushed remote.

## 5. Nightly sync

The 03:00 `~/bin/chezmoi-sync` run is the backup; without it this machine's changes die with it. mac: launchd job `com.collinlodato.chezmoi-sync` (write the plist into `~/Library/LaunchAgents` and load it if missing). WSL: `crontab` entry `0 3 * * * $HOME/bin/chezmoi-sync`, and confirm cron actually runs (Ubuntu on WSL2 needs `systemd=true` in `/etc/wsl.conf`).

Done when: the job appears in `launchctl list` / `crontab -l` and a manual `~/bin/chezmoi-sync` run exits clean.

## 6. Auth

Logins are interactive, so check each, and hand the user the exact command (run with the `!` prefix) for any that fail:

- `gh auth status` → `gh auth login`, then `gh auth setup-git`
- `gwsa list` (Google profiles) → re-auth ONLY via `~/bin/gwsa-login <profile>`

Done when: each service is authenticated or its login command has been handed over.

## 7. Report

State the restore point, the last dotfiles commit date, and that anything changed on a dead machine after it is gone. Then the evidence: skill count, broken symlinks (must be 0), repos cloned and verified, sync job status, auth gaps. Close with the standing rule: before wiping or retiring any machine, run `~/bin/chezmoi-sync` by hand; backups are only as fresh as the last 03:00 run.
