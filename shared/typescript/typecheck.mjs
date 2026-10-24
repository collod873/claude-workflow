import { refused, tscStage } from "./stages.mjs";
import { tsconfigRefusals } from "./tsconfig-guard.mjs";

const root = process.cwd();

if (refused("typescript", tsconfigRefusals(root, { ownsFileList: true }), "typecheck"))
  process.exit(1);
process.exit(tscStage(root, "tsconfig.json") ? 0 : 1);
