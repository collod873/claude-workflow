import { eslintStage, refused } from "./stages.mjs";
import { eslintRefusals } from "./verify.mjs";

const root = process.cwd();
const files = process.argv.slice(2);

if (refused("typescript", await eslintRefusals(root))) process.exit(1);
process.exit(eslintStage(root, files) ? 0 : 1);
