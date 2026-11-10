import ts from 'typescript';

/** @param {import('typescript').ImportDeclaration|import('typescript').ExportDeclaration} node */
function typeOnly(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    const named = clause?.namedBindings;
    return (
      clause?.isTypeOnly ||
      (!clause?.name &&
        named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly))
    );
  }
  const named = node.exportClause;
  return (
    node.isTypeOnly ||
    (named &&
      ts.isNamedExports(named) &&
      named.elements.length > 0 &&
      named.elements.every((element) => element.isTypeOnly))
  );
}

/** Literal dependency edges only; comments and prose never create dependencies.
 * @param {string} text @param {string} filename */
export function architectureSource(text, filename) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  /** @type {{specifier:string, runtimeStatic:boolean}[]} */
  const imports = [];
  /** @type {string[]} */
  const globals = [];
  /** @param {import('typescript').Node|undefined} value @param {boolean} runtimeStatic */
  const edge = (value, runtimeStatic) => {
    if (value && ts.isStringLiteralLike(value))
      imports.push({ specifier: value.text, runtimeStatic });
  };
  /** @param {import('typescript').BindingName} name */
  const binding = (name) => {
    if (ts.isIdentifier(name)) globals.push(name.text);
    else
      for (const element of name.elements) if (ts.isBindingElement(element)) binding(element.name);
  };
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      edge(node.moduleSpecifier, !typeOnly(node));
    } else if (ts.isExportDeclaration(node)) {
      edge(node.moduleSpecifier, !typeOnly(node));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      edge(node.argument.literal, false);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      edge(node.moduleReference.expression, !node.isTypeOnly);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) edge(node.arguments[0], false);
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        edge(node.arguments[0], true);
    }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
    )
      for (const declaration of node.declarationList.declarations) binding(declaration.name);
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
    )
      globals.push(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { imports, globals };
}
