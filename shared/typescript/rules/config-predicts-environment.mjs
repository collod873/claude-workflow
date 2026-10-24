const MACHINE_READS = new Set(["loadavg", "cpus", "availableParallelism"]);

function keyName(node, computed) {
  if (!computed && node.type === "Identifier") return node.name;
  return node.type === "Literal" ? node.value : null;
}

export function isProcessEnv(node) {
  return (
    node?.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === "process" &&
    keyName(node.property, node.computed) === "env"
  );
}

function calledName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") return keyName(callee.property, callee.computed);
  return null;
}

export const configPredictsEnvironment = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban a config file branching on process.env.CI or sampling load or CPU count to pick a limit.",
    },
    schema: [],
    messages: {
      predicts:
        "Config doesn't predict its environment: a timeout, retry cap or limit in a config file is a flat constant, never a branch on process.env.CI or a loadavg or CPU-count read, since both predictions missed a real load source. A non-limit use goes in this rule's ignores with its reason.",
    },
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: "predicts" });
    return {
      MemberExpression(node) {
        if (isProcessEnv(node.object) && keyName(node.property, node.computed) === "CI") {
          report(node);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !isProcessEnv(node.init)) return;
        for (const property of node.id.properties) {
          if (property.type === "Property" && keyName(property.key, property.computed) === "CI") {
            report(property);
          }
        }
      },
      CallExpression(node) {
        if (MACHINE_READS.has(calledName(node.callee))) report(node);
      },
    };
  },
};
