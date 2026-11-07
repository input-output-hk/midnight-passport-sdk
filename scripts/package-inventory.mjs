import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { generatedSources, testHelperDirectory } from './source-policy.mjs';

/** @param {string} root */
export function publishedSources(root = process.cwd()) {
  /** @type {{package:string, source:string, emitted:string, executable:boolean}[]} */
  const files = [];
  for (const pkg of readdirSync(resolve(root, 'packages')).sort()) {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'packages', pkg, 'package.json'), 'utf8'),
    );
    if (manifest.private) continue;
    /** @param {string} directory */
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (relative(root, file).replaceAll('\\', '/') !== testHelperDirectory) walk(file);
        } else if (entry.name.endsWith('.ts')) {
          const source = relative(root, file).replaceAll('\\', '/');
          if (generatedSources.includes(source)) continue;
          const emitted = source.replace('/src/', '/dist/').replace(/\.ts$/, '.js');
          // Use the actual compiler output, not the presence of TypeScript declarations.
          // Empty export stubs carry no executable authored behavior to cover.
          const executable =
            !entry.name.endsWith('.d.ts') &&
            (() => {
              const js = ts.createSourceFile(
                emitted,
                readFileSync(resolve(root, emitted), 'utf8'),
                ts.ScriptTarget.Latest,
              );
              return js.statements.some(
                (statement) =>
                  !(
                    ts.isExportDeclaration(statement) &&
                    statement.exportClause &&
                    ts.isNamedExports(statement.exportClause) &&
                    statement.exportClause.elements.length === 0 &&
                    !statement.moduleSpecifier
                  ),
              );
            })();
          files.push({ package: pkg, source, emitted, executable });
        }
      }
    };
    walk(resolve(root, 'packages', pkg, 'src'));
  }
  return files.sort((a, b) => a.source.localeCompare(b.source));
}
