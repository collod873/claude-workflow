import type { GitExec } from "./git.ts";
import { errorMessage } from "./reason.ts";

export interface SyncNotesRefOptions {
  git: GitExec;
  repoDir: string;
  ref: string;
  apply: () => void;
  remote?: string;
}

export function syncNotesRef(options: SyncNotesRefOptions): void {
  const { git, repoDir, ref, apply } = options;
  const remote = options.remote ?? "origin";
  const refspec = `refs/notes/${ref}:refs/notes/${ref}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    fetchNotesRef();
    apply();
    if (tryPush()) return;
  }

  throw new Error(`syncNotesRef: push to refs/notes/${ref} on "${remote}" rejected twice in a row`);

  function fetchNotesRef(): void {
    const remoteRef = git(["-C", repoDir, "ls-remote", remote, `refs/notes/${ref}`]);
    if (!remoteRef.trim()) return;
    git(["-C", repoDir, "fetch", remote, `+${refspec}`]);
  }

  function tryPush(): boolean {
    try {
      git(["-C", repoDir, "push", remote, refspec]);
      return true;
    } catch (error) {
      if (isRejection(error)) return false;
      throw error;
    }
  }
}

function isRejection(error: unknown): boolean {
  return errorMessage(error).includes("[rejected]");
}
