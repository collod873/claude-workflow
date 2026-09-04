import { pathToFileURL } from "node:url";
import { reason } from "./reason.ts";

export function runLaneCli(moduleUrl: string, usage: string, emit: (lane: string) => unknown): void {
  if (process.argv[1] === undefined || moduleUrl !== pathToFileURL(process.argv[1]).href) return;

  const lane = process.argv[2];
  if (!lane) {
    console.error(usage);
    process.exit(2);
  }

  try {
    console.log(JSON.stringify(emit(lane)));
  } catch (err) {
    console.error(reason(err));
    process.exit(2);
  }
}
