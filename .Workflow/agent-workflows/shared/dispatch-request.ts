import { appendFileSync } from "node:fs";
import type { GhExec } from "./gh";

export interface DispatchRequest {
  event_type: string;
  client_payload: Record<string, string | number>;
}

export const DISPATCH_REQUESTS_PATH_ENV = "DISPATCH_REQUESTS_PATH";

function dispatchArgs(request: DispatchRequest): string[] {
  const args = ["api", "repos/{owner}/{repo}/dispatches", "-f", `event_type=${request.event_type}`];
  for (const [key, value] of Object.entries(request.client_payload)) {
    args.push("-f", `client_payload[${key}]=${value}`);
  }
  return args;
}

export function requestDispatch(
  gh: GhExec,
  request: DispatchRequest,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = env[DISPATCH_REQUESTS_PATH_ENV];
  if (!path) {
    gh(dispatchArgs(request));
    return;
  }

  appendFileSync(path, `${JSON.stringify(request)}\n`, "utf8");
}
