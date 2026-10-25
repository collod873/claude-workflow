import { eslintStage, oxlintStage, refused } from "./stages.mjs";
import { eslintRefusals } from "./verify.mjs";

const root = process.cwd();
const files = process.argv.slice(2);

if (refused("typescript", await eslintRefusals(root))) process.exit(1);
const [eslint, oxlint] = await Promise.all([eslintStage(root, files), oxlintStage(root, files)]);
process.exit(eslint && oxlint ? 0 : 1);
