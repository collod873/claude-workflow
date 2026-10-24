function calledName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed) return callee.property.name;
  return null;
}

export const noMkdtempSync = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban a hand-rolled mkdtempSync sandbox in tests; the repo's sandbox helper owns it.",
    },
    schema: [
      {
        type: "object",
        properties: { helper: { type: "string" } },
        required: ["helper"],
        additionalProperties: false,
      },
    ],
    messages: {
      sandbox:
        "Hand-rolled mkdtempSync() sandbox. {{helper}} owns sandbox setup and cleanup, and per-suite copies are where cleanup bugs live (the /tmp leak). Compose the shared helper instead.",
    },
  },
  create(context) {
    const [{ helper }] = context.options;
    return {
      CallExpression(node) {
        if (calledName(node.callee) === "mkdtempSync") {
          context.report({ node, messageId: "sandbox", data: { helper } });
        }
      },
    };
  },
};
