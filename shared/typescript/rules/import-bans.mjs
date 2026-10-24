import { onImportSource } from "./import-sources.mjs";

const TEST_UTILS = /(?:^|\/)[^/]+-test-utils(?:\.[cm]?[jt]sx?)?$/;
const CHILD_PROCESS = new Set(["child_process", "node:child_process"]);

function isPackage(source, name) {
  return source === name || source.startsWith(`${name}/`);
}

export const noDevDependencyImport = {
  meta: {
    type: "problem",
    docs: { description: "Ban importing a devDependency from production code." },
    schema: [
      {
        type: "object",
        properties: { packages: { type: "array", items: { type: "string" } } },
        required: ["packages"],
        additionalProperties: false,
      },
    ],
    messages: {
      devDependency:
        "'{{source}}' is a devDependency in package.json, so importing it from production code can pull it into a production build or break one that installs without devDependencies. Keep test helpers in test files, src/test/ or a *-test-utils file.",
    },
  },
  create(context) {
    const [{ packages }] = context.options;
    return onImportSource((node, source) => {
      if (packages.some((name) => isPackage(source, name))) {
        context.report({ node, messageId: "devDependency", data: { source } });
      }
    });
  },
};

export const noTestUtilsImport = {
  meta: {
    type: "problem",
    docs: { description: "Ban importing a *-test-utils file from production code." },
    schema: [],
    messages: {
      testUtils:
        "'{{source}}' is a *-test-utils file, which may import devDependencies because only tests reach it. Importing it from production code smuggles those devDependencies past the devDependency ban.",
    },
  },
  create(context) {
    return onImportSource((node, source) => {
      if (TEST_UTILS.test(source)) {
        context.report({ node, messageId: "testUtils", data: { source } });
      }
    });
  },
};

export const noChildProcessInTests = {
  meta: {
    type: "problem",
    docs: { description: "Ban child_process in a test file not named *.proc.test.*." },
    schema: [],
    messages: {
      childProcess:
        "A test that drives a process is named *.proc.test.*, and this file is not one. Rename it if the process boundary is what is under test; otherwise import the subject and call it, since booting tools from tests is what made suites slow.",
    },
  },
  create(context) {
    return onImportSource((node, source) => {
      if (CHILD_PROCESS.has(source)) context.report({ node, messageId: "childProcess" });
    });
  },
};
