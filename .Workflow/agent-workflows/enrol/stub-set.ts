import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const STUB_SUFFIX = "-caller.yml";

export const WORKFLOWS_PATH = ".github/workflows";

export interface Stub {
  name: string;
  content: string;
  sha: string;
}

export interface RemoteFile {
  name: string;
  sha: string;
}

export interface EnrolPlan {
  writes: Stub[];
  deletes: RemoteFile[];
  unchanged: string[];
}

export function blobSha(content: string): string {
  const body = new TextEncoder().encode(content);
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

export function readStubSet(workflowsDir: string): Stub[] {
  return readdirSync(workflowsDir)
    .filter((name) => name.endsWith(STUB_SUFFIX))
    .sort()
    .map((name) => {
      const content = readFileSync(join(workflowsDir, name), "utf8");
      return { name, content, sha: blobSha(content) };
    });
}

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

export function planIsEmpty(plan: EnrolPlan): boolean {
  return plan.writes.length === 0 && plan.deletes.length === 0;
}
