import { appendFileSync } from "node:fs";
import type { GhExec } from "./gh";
import { trackerGh } from "./tracker-gh";

export interface DispatchRequest {
  event_type: string;
  client_payload: Record<string, string | number | string[]>;
}

export const DISPATCH_REQUESTS_PATH_ENV = "DISPATCH_REQUESTS_PATH";

export function requestDispatch(
  gh: GhExec,
  request: DispatchRequest,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = env[DISPATCH_REQUESTS_PATH_ENV];
  if (!path) {
    trackerGh(gh).dispatch(request);
    return;
  }

  appendFileSync(path, `${JSON.stringify(request)}\n`, "utf8");
}
