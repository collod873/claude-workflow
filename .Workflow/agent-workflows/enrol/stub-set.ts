import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * What the machine owns inside an enrolled repository, and how it decides what to change there.
 *
 * Everything in this file is a pure function of two directory listings — this repository's stubs
 * and the target's — so the decision "write this, delete that, leave the rest alone" is asserted
 * in a test without any of it reaching GitHub. `enrol.ts` is the half that talks to the API and
 * holds no policy of its own beyond what this returns.
 *
 * **The owned set is a glob, never a list.** ADR-0057's surviving rule (kept by ADR-0133) is that
 * every list the installer acts on is derived; a lane added here reaches every enrolled repository
 * on the next push because the glob widened, not because someone remembered to add a name. That
 * glob is also what keeps `enrol.yml` out of its own output: it is the one lane no enrolled
 * repository runs, so it has no caller stub, so it is not in the set — an exclusion that falls out
 * of the derivation rather than one written down beside it.
 *
 * **And it is a boundary, not just a filter.** A file in the target that does not match the glob
 * is never read, written, or deleted here: an enrolled repository's own CI belongs to that
 * repository. The delete half exists because the opposite of a missing stub is worse than a
 * missing stub — a stub left behind after its reusable workflow is gone names a `uses:` that
 * resolves to nothing, which is a lane that reds out on every event forever.
 */

/**
 * The suffix that makes a workflow file a caller stub.
 *
 * Load-bearing on both sides of the wire: it selects what this repository ships *and* what the
 * lane is allowed to delete in a target. Widening it would hand the machine the power to delete a
 * target's own workflows.
 */
export const STUB_SUFFIX = "-caller.yml";

/** Where a workflow file lives — the same path in this repository and in every enrolled one. */
export const WORKFLOWS_PATH = ".github/workflows";

/** One caller stub as this repository carries it, with the blob sha its bytes would hash to. */
export interface Stub {
  /** File name only, e.g. `verify-caller.yml` — never a path. */
  name: string;
  content: string;
  /** The git blob sha of `content`, for comparison against what the target reports. */
  sha: string;
}

/** One file the target already has in `.github/workflows`, as the contents API lists it. */
export interface RemoteFile {
  name: string;
  /** The git blob sha GitHub reports for it — an exact identity for its bytes. */
  sha: string;
}

/** What one enrolment pass would change in one target. */
export interface EnrolPlan {
  /** Stubs to write: absent from the target, or present with different bytes. */
  writes: Stub[];
  /** Stub-shaped files the target holds that this repository no longer carries. */
  deletes: RemoteFile[];
  /** Stubs already byte-identical in the target — the evidence a quiet run was not a blind one. */
  unchanged: string[];
}

/**
 * The git blob sha of some text — the same hash GitHub reports for a file in
 * `GET /repos/{o}/{r}/contents/{dir}`, which is what lets this lane compare bytes without
 * downloading a single file's content.
 *
 * Git's object header is part of what is hashed (`blob <byte length>\0`), so this is a sha of the
 * *object*, not of the content: a plain sha1 of the text would never match anything GitHub
 * reports, and would make every run rewrite every stub.
 */
export function blobSha(content: string): string {
  const body = new TextEncoder().encode(content);
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

/**
 * Every caller stub in `workflowsDir`, read off disk with its bytes and their blob sha.
 *
 * Sorted by name so a run's report, and the tree it builds, are stable between runs over an
 * unchanged repository — a diff that reorders itself is a diff nobody reads twice.
 */
export function readStubSet(workflowsDir: string): Stub[] {
  return readdirSync(workflowsDir)
    .filter((name) => name.endsWith(STUB_SUFFIX))
    .sort()
    .map((name) => {
      const content = readFileSync(join(workflowsDir, name), "utf8");
      return { name, content, sha: blobSha(content) };
    });
}

/**
 * What to change in a target that currently holds `remote`, given this repository carries `stubs`.
 *
 * `remote` is filtered to the owned glob before anything is compared, so a target file outside it
 * cannot appear in `deletes` however this is called — the boundary is enforced here rather than
 * left to every caller to remember.
 */
export function planFor(stubs: Stub[], remote: RemoteFile[]): EnrolPlan {
  const owned = remote.filter((file) => file.name.endsWith(STUB_SUFFIX));
  const remoteByName = new Map(owned.map((file) => [file.name, file]));
  const shipped = new Set(stubs.map((stub) => stub.name));

  const writes: Stub[] = [];
  const unchanged: string[] = [];
  for (const stub of stubs) {
    if (remoteByName.get(stub.name)?.sha === stub.sha) unchanged.push(stub.name);
    else writes.push(stub);
  }

  const deletes = owned.filter((file) => !shipped.has(file.name)).sort((a, b) => (a.name < b.name ? -1 : 1));

  return { writes, deletes, unchanged };
}

/** Whether a plan would change anything — a run over an already-current target writes nothing. */
export function planIsEmpty(plan: EnrolPlan): boolean {
  return plan.writes.length === 0 && plan.deletes.length === 0;
}
