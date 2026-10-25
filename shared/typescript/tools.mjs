import { existsSync, readFileSync } from "node:fs";

const readJson = (url) => JSON.parse(readFileSync(url, "utf8"));
const stamp = new URL("../STAMP.json", import.meta.url);

export const pinnedTools = Object.freeze(
  existsSync(stamp)
    ? readJson(stamp).tools
    : Object.assign(
        {},
        ...["typescript", "next"]
          .map((layer) => new URL(`../${layer}/tools.json`, import.meta.url))
          .filter((url) => existsSync(url))
          .map(readJson),
      ),
);
