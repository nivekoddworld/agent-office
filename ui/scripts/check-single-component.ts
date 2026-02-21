/**
 * Lint rule: at most one React component export per .tsx file.
 *
 * Detects exported function declarations and arrow-function const declarations
 * with PascalCase names as component exports. Uses TypeScript compiler API for
 * reliable AST parsing — no regex heuristics.
 *
 * Usage: tsx ui/scripts/check-single-component.ts
 * Exit code 0 = pass, 1 = violations found.
 */
import * as ts from "typescript";
import { readFileSync, globSync } from "node:fs";
import { resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function getExportedComponentNames(filePath: string): string[] {
  const source = readFileSync(filePath, "utf-8");
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names: string[] = [];

  for (const stmt of sf.statements) {
    const isExported =
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ??
      false;
    if (!isExported) continue;

    // export function Foo() { ... }
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name &&
      isPascalCase(stmt.name.text)
    ) {
      names.push(stmt.name.text);
    }

    // export const Foo = (...) => { ... }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          isPascalCase(decl.name.text) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          names.push(decl.name.text);
        }
      }
    }
  }

  return names;
}

const files = globSync("src/components/**/*.tsx", { cwd: ROOT }).map((f) =>
  resolve(ROOT, f),
);

let violations = 0;

for (const file of files) {
  const components = getExportedComponentNames(file);
  if (components.length > 1) {
    const rel = relative(ROOT, file);
    console.error(
      `${rel}: ${components.length} component exports (${components.join(", ")}). Max 1 per file.`,
    );
    violations++;
  }
}

if (violations > 0) {
  console.error(`\n${violations} file(s) with multiple component exports.`);
  process.exit(1);
} else {
  console.log(
    `Checked ${files.length} component files — all OK (≤1 export each).`,
  );
}
