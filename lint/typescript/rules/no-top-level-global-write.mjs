import { isProcessEnv } from "./config-predicts-environment.mjs";

const GLOBALS = new Set(["globalThis", "global", "window"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const DEFINERS = new Set(["assign", "defineProperty", "defineProperties"]);

function isGlobalObject(node) {
  return (node?.type === "Identifier" && GLOBALS.has(node.name)) || isProcessEnv(node);
}

function reachesGlobal(node) {
  if (isProcessEnv(node)) return true;
  let current = node;
  while (current?.type === "MemberExpression") {
    if (isGlobalObject(current.object)) return true;
    current = current.object;
  }
  return false;
}

function definesOnGlobal(node) {
  const callee = node.callee;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Object" &&
    DEFINERS.has(callee.property.name) &&
    isGlobalObject(node.arguments[0])
  );
}

function atModuleScope(context, node) {
  return !context.sourceCode.getAncestors(node).some((ancestor) => FUNCTIONS.has(ancestor.type));
}

export const noTopLevelGlobalWrite = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban writing globalThis, global, window or process.env at module scope, where no per-test hook can undo it.",
    },
    schema: [],
    messages: {
      write:
        "Module-scope write to globalThis, global, window or process.env: it runs once at import, before any per-test hook exists to undo it. Move it into beforeEach with a restore in afterEach, or use vi.stubGlobal or vi.stubEnv, which unstubGlobals and unstubEnvs restore.",
    },
  },
  create(context) {
    const report = (node) => {
      if (atModuleScope(context, node)) context.report({ node, messageId: "write" });
    };
    return {
      AssignmentExpression(node) {
        if (reachesGlobal(node.left)) report(node);
      },
      UpdateExpression(node) {
        if (reachesGlobal(node.argument)) report(node);
      },
      UnaryExpression(node) {
        if (node.operator === "delete" && reachesGlobal(node.argument)) report(node);
      },
      CallExpression(node) {
        if (definesOnGlobal(node)) report(node);
      },
    };
  },
};
