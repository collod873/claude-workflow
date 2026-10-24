const TEST_FUNCTIONS = new Set(["it", "test"]);
const CLASS_MATCHERS = new Set([
  "toContain",
  "toBe",
  "toMatch",
  "toEqual",
  "toStrictEqual",
  "toBeTruthy",
  "toBeFalsy",
]);

function calleeRoot(node) {
  let current = node;
  while (current) {
    if (current.type === "Identifier") return current.name;
    if (current.type === "MemberExpression") current = current.object;
    else if (current.type === "CallExpression") current = current.callee;
    else return null;
  }
  return null;
}

function isTestCall(node) {
  return node.type === "CallExpression" && TEST_FUNCTIONS.has(calleeRoot(node.callee));
}

function terminalMatcher(expectCall) {
  let current = expectCall;
  let matcher = null;
  while (current.parent?.type === "MemberExpression" && current.parent.object === current) {
    const member = current.parent;
    if (member.parent?.type === "CallExpression" && member.parent.callee === member) {
      if (member.property?.name) matcher = { name: member.property.name, call: member.parent };
      current = member.parent;
    } else {
      current = member;
    }
  }
  return matcher;
}

function propertyName(node) {
  return node?.type === "MemberExpression" && !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : null;
}

function readsClasses(node) {
  if (propertyName(node) === "className") return true;
  if (node?.type !== "CallExpression") return false;
  const method = propertyName(node.callee);
  if (method === "contains") return propertyName(node.callee.object) === "classList";
  return method === "getAttribute" && node.arguments[0]?.value === "class";
}

function isDataAttribute(node) {
  return (
    node?.type === "Literal" && typeof node.value === "string" && node.value.startsWith("data-")
  );
}

function classify(expectCall) {
  const matcher = terminalMatcher(expectCall);
  if (!matcher) return "other";
  if (matcher.name === "toHaveClass") return "classname";
  if (CLASS_MATCHERS.has(matcher.name) && readsClasses(expectCall.arguments[0])) return "classname";
  if (matcher.name === "toHaveAttribute" && isDataAttribute(matcher.call.arguments[0])) {
    return "echoedProp";
  }
  return "other";
}

export const noSoleClassnameAssertion = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban a test whose only assertions are class names or a prop echoed back as a data-* attribute.",
    },
    schema: [],
    messages: {
      classname:
        "This test's only assertions are class names, so a restyle breaks it and a broken behavior passes. Assert a behavioral fact (role, structure, a fired callback, visible text); a class check is fine beside one.",
      echoedProp:
        "This test's only assertions echo a prop back as a data-* attribute, which proves the render wired the prop and nothing it computes. Assert a computed outcome; an echoed prop is fine beside one.",
    },
  },
  create(context) {
    const frames = [];
    return {
      CallExpression(node) {
        if (isTestCall(node)) {
          frames.push({ node, kinds: [] });
        } else if (
          frames.length > 0 &&
          node.callee.type === "Identifier" &&
          node.callee.name === "expect"
        ) {
          frames.at(-1).kinds.push(classify(node));
        }
      },
      "CallExpression:exit"(node) {
        if (!isTestCall(node)) return;
        const { kinds } = frames.pop();
        if (kinds.length === 0 || kinds.includes("other")) return;
        const messageId = kinds.every((kind) => kind === "echoedProp") ? "echoedProp" : "classname";
        context.report({ node, messageId });
      },
    };
  },
};
