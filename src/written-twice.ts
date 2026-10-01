import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

interface Source {
  file: string;
  text: string;
}

interface Spot {
  file: string;
  line: number;
  pieces: string[];
}

const SKIPPED = /\.(test|part)\.ts$|(^|\/)scenarios\.ts$/;
const SIDE_BY_SIDE = 2;
const PLAIN_WORDS = 8;
const MARKED_WORDS = 6;
const MARKED = /^(#|<!--|\*\*)/;
const SAME_PATTERN = 8;
const GROUP_OPENER = /^\(\?(:|=|!|<=|<!|<[A-Za-z_]\w*>)?/;
const COUNTED = /^\{\d+(,\d*)?\}\??/;
const ASK = "export the text from one owner and build the other side from it";

const where = (spot: Spot) => `${spot.file}:${spot.line}`;

function wordsOf(pattern: string): string[] {
  const runs: string[] = [];
  let run = "";
  const end = () => {
    runs.push(run);
    run = "";
  };
  for (let at = 0; at < pattern.length; at++) {
    const char = pattern.charAt(at);
    const rest = pattern.slice(at);
    if (char === "\\") {
      const next = pattern.charAt(++at);
      if (/[A-Za-z0-9]/.test(next)) end();
      else run += next;
    } else if (char === "[") {
      end();
      while (at < pattern.length && pattern.charAt(at) !== "]") at += pattern.charAt(at) === "\\" ? 2 : 1;
    } else if ("?*+".includes(char) || COUNTED.test(rest)) {
      run = run.slice(0, -1);
      end();
      const quantifier = COUNTED.exec(rest)?.[0] ?? (pattern.charAt(at + 1) === "?" ? `${char}?` : char);
      at += quantifier.length - 1;
    } else if (char === "(") {
      end();
      at += (GROUP_OPENER.exec(rest)?.[0].length ?? 1) - 1;
    } else if ("^$.|)".includes(char)) {
      end();
    } else {
      run += char;
    }
  }
  end();
  return runs.filter((words) => (words.length >= PLAIN_WORDS && words.includes(" ")) || (words.length >= MARKED_WORDS && MARKED.test(words)));
}

function piecesOf(node: ts.Expression | undefined): string[] | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  return undefined;
}

const isRegExpCall = (node: ts.Node): node is ts.NewExpression | ts.CallExpression =>
  (ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp";

function spotsIn(source: Source) {
  const tree = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true);
  const spot = (node: ts.Node, pieces: string[]): Spot => ({
    file: source.file,
    line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
    pieces,
  });
  const patterns: Spot[] = [];
  const writes: Spot[] = [];
  const constants: Spot[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      patterns.push(spot(node, [node.text.slice(1, node.text.lastIndexOf("/"))]));
      return;
    }
    if (isRegExpCall(node)) {
      const pieces = piecesOf(node.arguments?.[0]);
      if (pieces !== undefined) {
        patterns.push(spot(node, pieces));
        node.arguments?.slice(1).forEach(visit);
        return;
      }
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    const pieces = piecesOf(node as ts.Expression);
    if (pieces !== undefined) writes.push(spot(node, pieces));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const pieces = piecesOf(declaration.initializer);
      if (pieces?.length === 1 && pieces[0] !== "") constants.push(spot(declaration, pieces));
    }
  }
  return { patterns, writes, constants };
}

const sideBySide = (one: Spot, other: Spot) => one.file === other.file && Math.abs(one.line - other.line) <= SIDE_BY_SIDE;

function sharedAcrossFiles(spots: Spot[], key: (spot: Spot) => string | undefined): [Spot, Spot][] {
  const first = new Map<string, Spot>();
  const pairs = new Map<string, [Spot, Spot]>();
  for (const spot of spots) {
    const text = key(spot);
    if (text === undefined) continue;
    const seen = first.get(text);
    if (seen === undefined) first.set(text, spot);
    else if (seen.file !== spot.file && !pairs.has(text)) pairs.set(text, [seen, spot]);
  }
  return [...pairs.values()];
}

export function writtenTwice(sources: Source[]): string[] {
  const read = [...sources].filter((source) => !SKIPPED.test(source.file)).sort((a, b) => a.file.localeCompare(b.file)).map(spotsIn);
  const patterns = read.flatMap((one) => one.patterns);
  const writes = read.flatMap((one) => one.writes);
  const constants = read.flatMap((one) => one.constants);
  const readsWritten = [
    ...new Set(
      patterns.flatMap((pattern) =>
        pattern.pieces.flatMap(wordsOf).flatMap((words) =>
          writes
            .filter((write) => !sideBySide(pattern, write) && write.pieces.some((piece) => piece.includes(words)))
            .map((write) => `written twice: ${where(pattern)} reads ${JSON.stringify(words)} that ${where(write)} writes; ${ASK}`),
        ),
      ),
    ),
  ];
  const samePatterns = sharedAcrossFiles(patterns, (pattern) => {
    const text = pattern.pieces.join("${}");
    return text.length >= SAME_PATTERN ? text : undefined;
  }).map(([one, other]) => `written twice: ${where(one)} and ${where(other)} spell the same pattern /${one.pieces.join("${}")}/; ${ASK}`);
  const sameConstants = sharedAcrossFiles(constants, (constant) => constant.pieces[0]).map(
    ([one, other]) => `written twice: ${where(one)} and ${where(other)} declare the same constant ${JSON.stringify(one.pieces[0])}; ${ASK}`,
  );
  return [...readsWritten, ...samePatterns, ...sameConstants];
}

const machineSource = (dir: string): Source[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ file: `src/${name}`, text: readFileSync(join(dir, name), "utf8") }));

if (import.meta.main) {
  const findings = writtenTwice(machineSource(import.meta.dirname));
  for (const finding of findings) console.log(finding);
  process.exit(findings.length > 0 ? 1 : 0);
}
