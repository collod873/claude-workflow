import { literalText } from "./import-sources.mjs";

const MOCKERS = new Set(["mock", "doMock"]);

function mockedModule(node) {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.object.type !== "Identifier" || callee.object.name !== "vi") return null;
  if (!MOCKERS.has(callee.property.name)) return null;
  const [target] = node.arguments;
  return literalText(target?.type === "ImportExpression" ? target.source : target);
}

export const noBoundaryMock = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban a second vi.mock of a module the whole suite shares; its one double lives in the repo's boundary home.",
    },
    schema: [
      {
        type: "object",
        properties: {
          modules: { type: "array", items: { type: "string" } },
          home: { type: "string" },
        },
        required: ["modules", "home"],
        additionalProperties: false,
      },
    ],
    messages: {
      boundary:
        "'{{module}}' is a boundary the whole suite shares: its one vi.mock lives in {{home}}, built over importOriginal so the double carries the real export set. A second mock with another shape is what breaks isolate: false. Widen the shared double, or mock a seam your own test owns.",
    },
  },
  create(context) {
    const [{ modules, home }] = context.options;
    const boundaries = new Set(modules);
    return {
      CallExpression(node) {
        const mocked = mockedModule(node);
        if (mocked !== null && boundaries.has(mocked)) {
          context.report({ node, messageId: "boundary", data: { module: mocked, home } });
        }
      },
    };
  },
};
