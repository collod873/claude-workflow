# Seeding a fresh machine

Skills can't run before they exist. Seed by hand, a few commands, then Claude Code takes over: open it anywhere and run `/converge`.

Both backup repos are private, so GitHub auth comes before chezmoi.

## macOS

```sh
# Homebrew if missing: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install chezmoi gh
curl -fsSL https://claude.ai/install.sh | bash
gh auth login && gh auth setup-git
chezmoi init --apply collod873/dotfiles
claude        # then: /converge
```

## Windows: use WSL2

The whole setup (bash scripts in `~/bin`, zsh, symlinked skills, chezmoi source) transfers to WSL2 unchanged: one bootstrap path for every machine. Native Windows Claude Code works, but would need `~/bin` ported off bash and Developer Mode for symlinks; only go native with a reason.

1. PowerShell (admin): `wsl --install -d Ubuntu`, reboot, create the Linux user.
2. Enable systemd so cron works (nightly backup depends on it):
   `printf '[boot]\nsystemd=true\n' | sudo tee /etc/wsl.conf` then from PowerShell `wsl --shutdown` and reopen Ubuntu.
3. Inside Ubuntu:

```sh
sudo apt update && sudo apt install -y git curl zsh gh cron
sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$HOME/.local/bin"
curl -fsSL https://claude.ai/install.sh | bash
gh auth login && gh auth setup-git
~/.local/bin/chezmoi init --apply collod873/dotfiles
chsh -s "$(which zsh)"
claude        # then: /converge
```

Notes for WSL:
- Keep repos on the Linux filesystem (`~/Claude Projects`), not `/mnt/c`; git is ~10x faster there.
- Browser-based logins (`gh`, `gwsa-login`) open the Windows browser automatically on Win11.
