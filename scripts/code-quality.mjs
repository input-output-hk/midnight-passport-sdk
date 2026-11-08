/** Fast TypeScript-AST analysis. Legacy budgets are explicit ceilings, never auto-updated. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { generatedSources } from './source-policy.mjs';

export const defaults = Object.freeze({
  lines: 600,
  functionLines: 150,
  complexity: 25,
  explicitAny: 0,
  nonNull: 0,
  unsafeCasts: 0,
  suppressions: 0,
});

/** @param {string} text @param {string} [name] */
export function inspectSource(text, name = 'source.ts') {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const metrics = {
    lines: text.trimEnd().split(/\r?\n/).length,
    functionLines: 0,
    complexity: 0,
    explicitAny: 0,
    nonNull: 0,
    unsafeCasts: 0,
    suppressions: 0,
  };
  /** @type {{line:number,lines:number,complexity:number}[]} */
  const functions = [];
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) metrics.explicitAny++;
    if (ts.isNonNullExpression(node)) metrics.nonNull++;
    if (
      ts.isAsExpression(node) &&
      (node.type.kind === ts.SyntaxKind.AnyKeyword ||
        (ts.isAsExpression(node.expression) &&
          node.expression.type.kind === ts.SyntaxKind.UnknownKeyword))
    )
      metrics.unsafeCasts++;
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const body = /** @type {import('typescript').Node} */ (node.body);
      let complexity = 1;
      /** @param {import('typescript').Node} child */
      const scan = (child) => {
        if (child !== body && ts.isFunctionLike(child)) return;
        if (
          ts.isIfStatement(child) ||
          ts.isConditionalExpression(child) ||
          ts.isForStatement(child) ||
          ts.isForInStatement(child) ||
          ts.isForOfStatement(child) ||
          ts.isWhileStatement(child) ||
          ts.isDoStatement(child) ||
          ts.isCaseClause(child) ||
          ts.isCatchClause(child) ||
          (ts.isBinaryExpression(child) &&
            [
              ts.SyntaxKind.AmpersandAmpersandToken,
              ts.SyntaxKind.BarBarToken,
              ts.SyntaxKind.QuestionQuestionToken,
            ].includes(child.operatorToken.kind))
        )
          complexity++;
        ts.forEachChild(child, scan);
      };
      scan(body);
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const lines = source.getLineAndCharacterOfPosition(node.end).line - line + 2;
      functions.push({ line, lines, complexity });
      metrics.functionLines = Math.max(metrics.functionLines, lines);
      metrics.complexity = Math.max(metrics.complexity, complexity);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    )
      metrics.suppressions += (
        scanner.getTokenText().match(/@ts-(?:ignore|nocheck)\b/g) ?? []
      ).length;
  }
  return { metrics, functions };
}

/** @param {Record<string,number>} metrics @param {Record<string,number>} [budget] */
export function qualityFailures(metrics, budget = {}) {
  return Object.entries(defaults).flatMap(([metric, limit]) =>
    metrics[metric] === undefined || metrics[metric] > (budget[metric] ?? limit)
      ? [`${metric}: ${metrics[metric]} exceeds ${budget[metric] ?? limit}`]
      : [],
  );
}

export function qualityInventory(root = process.cwd()) {
  /** @type {Record<string,ReturnType<typeof inspectSource>>} */
  const inventory = {};
  /** @param {string} directory @param {'.ts'|'.mjs'} [extension] */
  const walk = (directory, extension = '.ts') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(file, extension);
      else if (entry.name.endsWith(extension)) {
        const path = relative(root, file).replaceAll('\\', '/');
        if (generatedSources.includes(path)) continue;
        inventory[path] = inspectSource(readFileSync(file, 'utf8'), path);
      }
    }
  };
  for (const pkg of readdirSync(resolve(root, 'packages')).sort())
    walk(resolve(root, 'packages', pkg, 'src'));
  walk(resolve(root, 'apps/passport-dapp/src'));
  const journeys = 'apps/passport-dapp/e2e/demo-journeys.e2e.ts';
  inventory[journeys] = inspectSource(readFileSync(resolve(root, journeys), 'utf8'), journeys);
  walk(resolve(root, 'apps/passport-dapp/e2e/journeys'));
  walk(resolve(root, 'apps/passport-dapp/e2e/journeys'), '.mjs');
  walk(resolve(root, 'scripts/consumer'), '.mjs');
  return inventory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = qualityInventory();
  if (process.argv.includes('--report')) console.log(JSON.stringify(inventory, null, 2));
  else {
    const policy = JSON.parse(readFileSync('scripts/code-quality-budgets.json', 'utf8'));
    const failures = [];
    for (const [file, result] of Object.entries(inventory))
      failures.push(
        ...qualityFailures(result.metrics, policy.files[file]?.ceilings).map(
          (message) => `${file}: ${message}`,
        ),
      );
    if (failures.length) {
      console.error(failures.join('\n'));
      process.exitCode = 1;
    } else
      console.log(
        `AST quality budgets respected in ${Object.keys(inventory).length} authored files.`,
      );
  }
}
