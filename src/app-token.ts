import { createSign } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { type Gh, unread } from "./post.ts";

const JWT_LIFE = 540;
const GITHUB_HEADER = "http.https://github.com/.extraheader";

export interface AppKey {
  clientId: string;
  key: string;
}

const url64 = (text: string) => Buffer.from(text).toString("base64url");

export function appJwt({ clientId, key }: AppKey): string {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${url64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${url64(JSON.stringify({ iat: now - 60, exp: now + JWT_LIFE, iss: clientId }))}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key, "base64url")}`;
}

export function takenAppKey(): AppKey | undefined {
  const file = process.env.APP_KEY_FILE;
  if (file === undefined || file === "") return undefined;
  const held = JSON.parse(readFileSync(file, "utf8")) as AppKey;
  rmSync(file);
  return held;
}

export function freshAppToken(app: AppKey, gh: Gh, line: string): void {
  const asApp = (args: string[]) => {
    const got = gh(["api", "-H", `Authorization: Bearer ${appJwt(app)}`, ...args]);
    return got.status === 0 && got.stdout.trim() !== "" ? got.stdout.trim() : unread(`a fresh App token could not be minted, ${line}`);
  };
  const installation = asApp(["repos/{owner}/{repo}/installation", "--jq", ".id"]);
  const token = asApp(["-X", "POST", `app/installations/${installation}/access_tokens`, "--jq", ".token"]);
  Object.assign(process.env, {
    GH_TOKEN: token,
    QUIET_GH_TOKEN: token,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: GITHUB_HEADER,
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: GITHUB_HEADER,
    GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  });
}
