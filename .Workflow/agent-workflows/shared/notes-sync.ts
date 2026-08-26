import type { GitExec } from "./git";
import { reason } from "./reason";

export interface SyncNotesRefOptions {
  git: GitExec;
  /** The repo to operate in, threaded as `-C <repoDir>` — never baked into `git`'s closure. */
  repoDir: string;
  /**
   * The notes ref's unqualified name, resolved under `refs/notes/` the same
   * way every reader and writer in this tree already does (`notes.ts`'s and
   * `ratification.ts`'s own `NOTES_REF`) — `"sessions"`, `"observations"`,
   * or `"ratifications"`.
   */
  ref: string;
  /**
   * Writes (or rewrites) the local note this call means to publish, against
   * whatever `refs/notes/<ref>` currently holds locally. Called once before
   * the first push attempt and, if that push is rejected non-fast-forward,
   * once more against a freshly re-fetched local ref — so a caller's write
   * (typically `git notes add -f`) always lands on top of the latest known
   * remote state rather than on a stale or divergent one.
   */
  apply: () => void;
  /** The remote to fetch from and push to. Defaults to `"origin"`. */
  remote?: string;
}

/**
 * Publishes one write to a notes ref, tolerating the ordinary race of two
 * runs finishing close together (docs/adr/0016, the observations spec's
 * "Notes refs and concurrency" section): fetch, apply, push; and if that
 * push is rejected because the remote moved since the fetch, do it again
 * exactly once — fetch, apply, push — before surfacing the failure.
 *
 * A second consecutive rejection throws rather than retrying further: a
 * ref losing this race twice in a row past the first ordinary contention
 * is not the "two sessions ending within a minute of each other" case this
 * exists to smooth over, and retrying indefinitely would turn a real
 * problem (a wedged remote, a third and fourth racer) into a hang.
 */
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

  /**
   * Brings the local ref up to the remote's current tip before `apply` runs
   * on top of it. Forced (`+refspec`), because the point of re-fetching
   * after a rejection is to discard whatever unpushed local commit lost the
   * race and rebuild `apply`'s write on the remote's latest instead — not
   * to preserve a local history nothing else will ever see. Skipped
   * entirely when the remote has no such ref yet: that is the first-ever
   * publish, `apply` builds the ref's first commit, and fetching a ref that
   * does not exist is itself the failure `git fetch` would report.
   */
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

/**
 * `git push`'s rejection line for a ref the remote has moved past — whether
 * the two histories share an ancestor ("non-fast-forward") or share none at
 * all ("fetch first") — always opens with `! [rejected]`. That prefix is
 * what tells this apart from every other way a push can fail (no such
 * remote, no permission, network down), which this surfaces as-is rather
 * than treating as the ordinary race.
 */
function isRejection(error: unknown): boolean {
  return reason(error).includes("[rejected]");
}
