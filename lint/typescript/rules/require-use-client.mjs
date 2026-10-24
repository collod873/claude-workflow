const CLIENT_ONLY_HOOKS = new Set([
  "useState",
  "useReducer",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useRef",
  "useImperativeHandle",
  "useSyncExternalStore",
  "useTransition",
  "useDeferredValue",
  "useOptimistic",
  "useActionState",
  "useContext",
  "useFormStatus",
]);
const REACT_SOURCES = new Set(["react", "react-dom"]);

function declaresUseClient(program) {
  for (const statement of program.body) {
    const directive = statement.type === "ExpressionStatement" ? statement.expression : undefined;
    if (directive?.type !== "Literal" || typeof directive.value !== "string") {
      return false;
    }
    if (directive.value === "use client") return true;
  }
  return false;
}

function isInertHandler(expression) {
  return (
    expression.type === "Literal" ||
    expression.type === "TemplateLiteral" ||
    (expression.type === "Identifier" && expression.name === "undefined")
  );
}

export const requireUseClient = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Require "use client" in a server-entry module that passes event handlers or calls client-only hooks, which next build rejects while lint and tsc pass.',
    },
    schema: [],
    messages: {
      handler:
        'Event-handler prop in a file with no "use client": it renders as a Server Component, so next build fails at prerender while lint and tsc pass. Add "use client" if this is a client leaf, or move the interactivity into a client island.',
      hook: 'Client-only React hook in a file with no "use client": it renders as a Server Component, so next build fails while lint and tsc pass. Add "use client", or move the stateful part into a client island.',
    },
  },
  create(context) {
    if (declaresUseClient(context.sourceCode.ast)) return {};
    const hookLocals = new Set();
    const namespaceLocals = new Set();
    return {
      ImportDeclaration(node) {
        if (!REACT_SOURCES.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            CLIENT_ONLY_HOOKS.has(specifier.imported.name)
          ) {
            hookLocals.add(specifier.local.name);
          } else if (
            specifier.type === "ImportNamespaceSpecifier" ||
            specifier.type === "ImportDefaultSpecifier"
          ) {
            namespaceLocals.add(specifier.local.name);
          }
        }
      },
      JSXAttribute(node) {
        if (node.name?.type !== "JSXIdentifier" || !/^on[A-Z]/.test(node.name.name)) return;
        if (node.value?.type !== "JSXExpressionContainer") return;
        if (isInertHandler(node.value.expression)) return;
        context.report({ node, messageId: "handler" });
      },
      CallExpression(node) {
        const callee = node.callee;
        const bareHook = callee.type === "Identifier" && hookLocals.has(callee.name);
        const namespacedHook =
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          namespaceLocals.has(callee.object.name) &&
          callee.property.type === "Identifier" &&
          CLIENT_ONLY_HOOKS.has(callee.property.name);
        if (bareHook || namespacedHook) context.report({ node, messageId: "hook" });
      },
    };
  },
};
