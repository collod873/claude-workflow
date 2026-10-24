function literalText(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function isRequire(node) {
  return node.callee.type === "Identifier" && node.callee.name === "require";
}

export function onImportSource(visit) {
  const at = (node, source) => {
    const text = literalText(source);
    if (text !== null) visit(node, text);
  };
  return {
    ImportDeclaration: (node) => at(node, node.source),
    ExportAllDeclaration: (node) => at(node, node.source),
    ExportNamedDeclaration: (node) => node.source && at(node, node.source),
    ImportExpression: (node) => at(node, node.source),
    TSImportEqualsDeclaration: (node) =>
      node.moduleReference.type === "TSExternalModuleReference" &&
      at(node, node.moduleReference.expression),
    CallExpression: (node) => isRequire(node) && at(node, node.arguments[0]),
  };
}

export { literalText };
