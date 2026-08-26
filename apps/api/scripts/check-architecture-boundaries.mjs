import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const apiRoot = resolveApiRoot(process.argv.slice(2));
const sourceRoot = resolve(apiRoot, "src");
const testRoot = resolve(apiRoot, "tests");
const ignoredDirectories = new Set(["dist", "generated", "node_modules"]);
const repositoryPortPattern = /^[A-Z][A-Za-z0-9]*Repository$/;
const repositoryModulePattern = /\.repository(?:\.(?:js|ts))?$/;

const sourceFiles = collectTypeScriptFiles(sourceRoot);
const inspectedFiles = [...sourceFiles, ...collectTypeScriptFiles(testRoot)];
const parsedFiles = new Map(
  inspectedFiles.map((filePath) => [filePath, parseTypeScript(filePath)])
);
const violations = [
  ...findRepositoryDeclarationViolations(sourceFiles, parsedFiles),
  ...findContractDependencyViolations(sourceFiles, parsedFiles),
  ...findRepositoryPortImportViolations(inspectedFiles, parsedFiles),
  ...findRuntimeCycles(sourceFiles, parsedFiles),
];

if (violations.length > 0) {
  console.error("Architecture boundary check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Architecture boundaries passed (${sourceFiles.length} source files, ${inspectedFiles.length - sourceFiles.length} test files).`
  );
}

function collectTypeScriptFiles(root) {
  const files = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...collectTypeScriptFiles(resolve(root, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".ts") {
      files.push(resolve(root, entry.name));
    }
  }

  return files.sort();
}

function parseTypeScript(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function findRepositoryDeclarationViolations(files, parsed) {
  const violations = [];

  for (const filePath of files.filter((candidate) => candidate.endsWith(".repository.ts"))) {
    for (const statement of parsed.get(filePath).statements) {
      if (
        isExported(statement) &&
        (ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isModuleDeclaration(statement))
      ) {
        violations.push(
          `${displayPath(filePath)}:${lineNumber(parsed.get(filePath), statement)} declares exported contract ${statement.name.text}; move it to a *.types.ts file`
        );
      }

      if (ts.isExportDeclaration(statement) && exportsContract(statement)) {
        violations.push(
          `${displayPath(filePath)}:${lineNumber(parsed.get(filePath), statement)} re-exports types from a concrete repository`
        );
      }
    }
  }

  return violations;
}

function findContractDependencyViolations(files, parsed) {
  const violations = [];

  for (const filePath of files.filter((candidate) => candidate.endsWith(".types.ts"))) {
    for (const statement of parsed.get(filePath).statements) {
      const moduleName = moduleSpecifierText(statement);
      if (moduleName && repositoryModulePattern.test(moduleName)) {
        violations.push(
          `${displayPath(filePath)}:${lineNumber(parsed.get(filePath), statement)} makes a contract file depend on ${moduleName}`
        );
      }
    }
  }

  return violations;
}

function findRepositoryPortImportViolations(files, parsed) {
  const violations = [];

  for (const filePath of files) {
    const sourceFile = parsed.get(filePath);

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;

      const moduleName = moduleSpecifierText(statement);
      if (!moduleName || !repositoryModulePattern.test(moduleName)) continue;

      const importedPorts = importedNames(statement).filter((name) =>
        repositoryPortPattern.test(name)
      );

      if (importedPorts.length > 0) {
        violations.push(
          `${displayPath(filePath)}:${lineNumber(sourceFile, statement)} imports ${importedPorts.join(", ")} from concrete module ${moduleName}`
        );
      }
    }
  }

  return violations;
}

function findRuntimeCycles(files, parsed) {
  const sourceSet = new Set(files);
  const graph = new Map(
    files.map((filePath) => [
      filePath,
      runtimeDependencies(filePath, parsed.get(filePath)).filter((dependency) =>
        sourceSet.has(dependency)
      ),
    ])
  );
  const state = new Map();
  const stack = [];
  const cycles = [];
  const cycleKeys = new Set();

  function visit(filePath) {
    state.set(filePath, "visiting");
    stack.push(filePath);

    for (const dependency of graph.get(filePath) || []) {
      if (!state.has(dependency)) {
        visit(dependency);
        continue;
      }

      if (state.get(dependency) === "visiting") {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const key = canonicalCycleKey(cycle.slice(0, -1));
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push(cycle);
        }
      }
    }

    stack.pop();
    state.set(filePath, "visited");
  }

  for (const filePath of files) {
    if (!state.has(filePath)) visit(filePath);
  }

  return cycles.map(
    (cycle) => `runtime dependency cycle: ${cycle.map(displayPath).join(" -> ")}`
  );
}

function runtimeDependencies(filePath, sourceFile) {
  const dependencies = [];

  for (const statement of sourceFile.statements) {
    const moduleName = moduleSpecifierText(statement);
    if (!moduleName || !moduleName.startsWith(".")) continue;

    if (ts.isImportDeclaration(statement) && !isRuntimeImport(statement)) continue;
    if (ts.isExportDeclaration(statement) && !isRuntimeExport(statement)) continue;
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;

    const resolvedDependency = resolveTypeScriptModule(filePath, moduleName);
    if (resolvedDependency) dependencies.push(resolvedDependency);
  }

  return dependencies;
}

function resolveTypeScriptModule(importerPath, moduleName) {
  const basePath = resolve(dirname(importerPath), moduleName);
  const candidates = moduleName.endsWith(".js")
    ? [`${basePath.slice(0, -3)}.ts`]
    : moduleName.endsWith(".ts")
      ? [basePath]
      : [`${basePath}.ts`, resolve(basePath, "index.ts")];

  return candidates.find((candidate) => parsedFiles.has(candidate));
}

function isRuntimeImport(statement) {
  if (!statement.importClause) return true;
  if (statement.importClause.isTypeOnly) return false;
  if (statement.importClause.name) return true;

  const bindings = statement.importClause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return Boolean(bindings);
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function isRuntimeExport(statement) {
  if (statement.isTypeOnly) return false;
  if (!statement.exportClause) return true;
  if (ts.isNamespaceExport(statement.exportClause)) return true;
  return statement.exportClause.elements.some((element) => !element.isTypeOnly);
}

function importedNames(statement) {
  const names = [];
  const clause = statement.importClause;
  if (!clause) return names;
  if (clause.name) names.push(clause.name.text);

  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      names.push(element.name.text);
    }
  }

  return names;
}

function moduleSpecifierText(statement) {
  if (
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return statement.moduleSpecifier.text;
  }

  return null;
}

function isExported(node) {
  return node.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  );
}

function exportsContract(statement) {
  if (statement.isTypeOnly) return true;
  if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
    return false;
  }

  return statement.exportClause.elements.some(
    (element) => element.isTypeOnly || repositoryPortPattern.test(element.name.text)
  );
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function displayPath(filePath) {
  return relative(apiRoot, filePath).replaceAll("\\", "/");
}

function canonicalCycleKey(cycle) {
  const paths = cycle.map(displayPath);
  const rotations = paths.map((_, index) => [
    ...paths.slice(index),
    ...paths.slice(0, index),
  ].join("|"));
  return rotations.sort()[0];
}

function resolveApiRoot(args) {
  const rootFlagIndex = args.indexOf("--api-root");
  if (rootFlagIndex === -1) {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..");
  }

  const requestedRoot = args[rootFlagIndex + 1];
  if (!requestedRoot || requestedRoot.startsWith("--")) {
    throw new Error("--api-root requires a directory path");
  }

  return resolve(requestedRoot);
}
