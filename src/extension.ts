import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import * as vscode from "vscode";
import * as ts from "typescript";
import { createSourceFile } from "typescript";
import { print } from "util";

export interface ModuleInfo {
  isDirectoryModule: boolean;
  name: string;
  modulePath: string;
  importPath: string;
}

export function activate(context: vscode.ExtensionContext) {
  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json

  let disposable = vscode.commands.registerCommand(
    "module-gateway-generator.generate",
    () => {
      const textEditor = vscode.window.activeTextEditor;
      if (!textEditor) {
        return;
      }

      const doc = textEditor.document;

      const moduleDirectory = path.dirname(doc.uri.path);
      const moduleGatewayFile = path.join(moduleDirectory, "index.ts");

      const modules: ModuleInfo[] = fs
        .readdirSync(moduleDirectory)
        .map(file => {
          const modulePath = path.join(moduleDirectory, file);
          const fsStat = fs.statSync(modulePath);
          const isDirectory = fsStat.isDirectory();
          const isDirectoryModule =
            isDirectory && fs.existsSync(path.join(modulePath, "index.ts"));

          if (isDirectory && !isDirectoryModule) {
            return null;
          }

          if (/^index\.tsx?$/.test(file)) {
            return null;
          }

          if (!isDirectory) {
            const analysis = analyseFile(modulePath);
            if (analysis.exportCount === 0) {
              return null;
            }
          }

          return {
            isDirectoryModule,
            name: file,
            modulePath,
            importPath: `./${file.replace(/\.[tj]sx?$/, "")}`
          };
        })
        .filter(module => module !== undefined && module !== null) as any;

      if (!fs.existsSync(moduleGatewayFile)) {
        const moduleGatewayContent = modules
          .map(m => `export * from '${m!.importPath}';`)
          .join(os.EOL);
        fs.writeFileSync(moduleGatewayFile, moduleGatewayContent, "utf-8");
      } else {
        updateModuleGateway(moduleGatewayFile, modules);
      }
    }
  );

  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}

function updateModuleGateway(file: string, modules: ModuleInfo[]) {
  const sourceFile = createSourceFile(
    file,
    fs.readFileSync(file).toString("utf-8"),
    ts.ScriptTarget.ES2015
  );

  const existingImports: string[] = [];
  let lastExport: ts.ExportDeclaration = null!;
  let lastExportIndex = 0;
  let pos = 0;

  ts.forEachChild(sourceFile, node => {
    switch (node.kind) {
      case ts.SyntaxKind.ExportDeclaration:
        if (ts.isExportDeclaration(node)) {
          lastExport = node;
          lastExportIndex = pos;
          const moduleSpecifier: ts.Node = node.moduleSpecifier!;
          if (ts.isStringLiteral(moduleSpecifier)) {
            existingImports.push(moduleSpecifier.text);
          }
        }
    }
    pos++;
  });

  let newModules = modules
    .filter(module => !existingImports.includes(module.importPath))
    .map(module =>
      ts.createExportDeclaration(
        [],
        [],
        undefined,
        ts.createStringLiteral(module.importPath)
      )
    );
  if (lastExport === null) {
    lastExportIndex = 0;
  }

  console.info(lastExportIndex);
  sourceFile.statements = ts.createNodeArray([
    ...sourceFile.statements.slice(0, lastExportIndex + 1),
    ...newModules,
    ...sourceFile.statements.slice(lastExportIndex + 1)
  ]);

  const printer = ts.createPrinter();
  fs.writeFileSync(file, printer.printFile(sourceFile), "utf-8");
}

function analyseFile(file: string): { exportCount: number } {
  const sourceFile = createSourceFile(
    file,
    fs.readFileSync(file).toString("utf-8"),
    ts.ScriptTarget.ES2015
  );

  let exportCount = 0;
  function visitExports(node: ts.Node) {
    switch (node.kind) {
      case ts.SyntaxKind.ExportDeclaration:
      case ts.SyntaxKind.ExportAssignment:
      case ts.SyntaxKind.ExportSpecifier:
      case ts.SyntaxKind.ExportKeyword:
        exportCount++;
        break;
      default:
        ts.forEachChild(node, visitExports);
    }
  }

  ts.forEachChild(sourceFile, visitExports);

  return {
    exportCount
  };
}
