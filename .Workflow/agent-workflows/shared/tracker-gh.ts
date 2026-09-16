import type { GhExec } from "./gh";
import type { Tracker } from "./tracker";

export function trackerGh(gh: GhExec): Tracker {
  void gh;
  throw new Error("#607: not built");
}
