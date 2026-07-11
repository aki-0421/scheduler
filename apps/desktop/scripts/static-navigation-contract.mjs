import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import ts from "typescript";

export const STATIC_SCREEN_PATHS = [
  "/",
  "/projects",
  "/tasks",
  "/tasks/new",
  "/runs",
  "/settings",
];

const FORBIDDEN_ROUTER_MODULES = new Map([
  ["next/link", "next/link enables RSC payload navigation in a Tauri bundle"],
  ["next/router", "next/router enables client routing in a Tauri bundle"],
]);
const NEXT_NAVIGATION_MODULE = "next/navigation";
const READ_ONLY_NEXT_NAVIGATION_EXPORTS = new Set([
  "usePathname",
  "useSearchParams",
]);
const HISTORY_METHODS = new Set(["pushState", "replaceState"]);
const DYNAMIC_RAW_ANCHOR_FILE_ALLOWLIST = new Map([
  [
    "components/markdown-content.tsx",
    "ReactMarkdown passes URLs through defaultUrlTransform and this renderer opens them as isolated external links.",
  ],
]);

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

function moduleNameFromCall(node) {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) {
    return undefined;
  }

  const argument = node.arguments[0];
  if (!ts.isStringLiteralLike(argument)) {
    return undefined;
  }

  if (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require")
  ) {
    return argument.text;
  }

  return undefined;
}

function unwrapExpression(node) {
  let expression = node;
  while (
    ts.isAwaitExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function staticPropertyName(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    return staticStringValue(node.argumentExpression);
  }
  return undefined;
}

function propertyOwner(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ? node.expression
    : undefined;
}

function staticStringValue(node) {
  const expression = unwrapExpression(node);
  if (
    ts.isStringLiteralLike(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(expression.left);
    const right = staticStringValue(expression.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function jsxAttribute(openingElement, name) {
  return openingElement.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  );
}

function jsxAttributeExpression(attribute) {
  if (!attribute?.initializer) {
    return undefined;
  }
  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer;
  }
  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression;
  }
  return undefined;
}

function isIntrinsicAnchor(node) {
  return (
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    ts.isIdentifier(node.tagName) &&
    node.tagName.text === "a"
  );
}

function dynamicRawAnchorException(filePath) {
  const normalizedPath = resolve(filePath).replaceAll("\\", "/");
  return [...DYNAMIC_RAW_ANCHOR_FILE_ALLOWLIST].find(([suffix]) =>
    normalizedPath.endsWith(`/${suffix}`),
  );
}

function createProgram(sourcePaths) {
  return ts.createProgram({
    rootNames: sourcePaths,
    options: {
      allowJs: false,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      noResolve: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    },
  });
}

function formatViolation(violation) {
  return `${violation.filePath}:${violation.line}:${violation.column} ${violation.message}`;
}

export function scanRuntimeNavigationContract({
  sourcePaths,
  allowedRawAnchorPaths = [],
}) {
  const normalizedPaths = sourcePaths.map((path) => resolve(path));
  const allowedAnchors = new Set(allowedRawAnchorPaths.map((path) => resolve(path)));
  const program = createProgram(normalizedPaths);
  const checker = program.getTypeChecker();
  const sourceFiles = normalizedPaths.map((path) => {
    const sourceFile = program.getSourceFile(path);
    if (!sourceFile) {
      throw new Error(`Unable to parse runtime source: ${path}`);
    }
    return sourceFile;
  });
  const violations = [];
  const violationKeys = new Set();
  const navigationNamespaces = new Set();
  const historyObjects = new Set();
  const historyMethodBindings = new Map();

  const symbolAt = (identifier) =>
    ts.isIdentifier(identifier) ? checker.getSymbolAtLocation(identifier) : undefined;

  const addSymbol = (set, identifier) => {
    const symbol = symbolAt(identifier);
    if (!symbol || set.has(symbol)) {
      return false;
    }
    set.add(symbol);
    return true;
  };

  const addViolation = (sourceFile, node, code, message) => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    const key = `${sourceFile.fileName}:${node.pos}:${code}`;
    if (violationKeys.has(key)) {
      return;
    }
    violationKeys.add(key);
    violations.push({
      code,
      column: position.character + 1,
      filePath: sourceFile.fileName,
      line: position.line + 1,
      message,
    });
  };

  const resolveStringCandidates = (node, seenSymbols = new Set()) => {
    if (!node) {
      return undefined;
    }
    const expression = unwrapExpression(node);
    if (ts.isStringLiteralLike(expression)) {
      return [{ complete: true, value: expression.text }];
    }
    if (ts.isIdentifier(expression)) {
      const symbol = symbolAt(expression);
      if (!symbol || seenSymbols.has(symbol)) {
        return undefined;
      }
      const declaration = symbol.declarations?.find(
        (candidate) =>
          ts.isVariableDeclaration(candidate) &&
          candidate.initializer &&
          ts.isVariableDeclarationList(candidate.parent) &&
          (candidate.parent.flags & ts.NodeFlags.Const) !== 0,
      );
      if (!declaration?.initializer) {
        return undefined;
      }
      const nextSeen = new Set(seenSymbols);
      nextSeen.add(symbol);
      return resolveStringCandidates(declaration.initializer, nextSeen);
    }
    if (ts.isConditionalExpression(expression)) {
      const whenTrue = resolveStringCandidates(expression.whenTrue, seenSymbols);
      const whenFalse = resolveStringCandidates(expression.whenFalse, seenSymbols);
      return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
    }
    if (ts.isTemplateExpression(expression)) {
      let candidates = [{ complete: true, value: expression.head.text }];
      for (const span of expression.templateSpans) {
        const values = resolveStringCandidates(span.expression, seenSymbols);
        if (!values) {
          return candidates.some(({ value }) => value !== "")
            ? candidates.map(({ value }) => ({ complete: false, value }))
            : undefined;
        }
        candidates = candidates.flatMap((prefix) =>
          values.map((value) => ({
            complete: prefix.complete && value.complete,
            value: `${prefix.value}${value.value}${span.literal.text}`,
          })),
        );
      }
      return candidates;
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = resolveStringCandidates(expression.left, seenSymbols);
      const right = resolveStringCandidates(expression.right, seenSymbols);
      if (!left) {
        return undefined;
      }
      if (!right) {
        return left.some(({ value }) => value !== "")
          ? left.map(({ value }) => ({ complete: false, value }))
          : undefined;
      }
      return left.flatMap((prefix) =>
        right.map((suffix) => ({
          complete: prefix.complete && suffix.complete,
          value: `${prefix.value}${suffix.value}`,
        })),
      );
    }
    return undefined;
  };

  const isSafeRawAnchorCandidate = ({ value }) => {
    const normalized = value.trimStart();
    return (
      normalized.startsWith("#") ||
      normalized.startsWith("//") ||
      /^https?:\/\//i.test(normalized) ||
      /^(?:mailto|tel):/i.test(normalized)
    );
  };

  const isSafeHistoryCandidate = ({ complete, value }) => {
    const normalized = value.trimStart();
    return (
      (complete && normalized === "") ||
      normalized.startsWith("?") ||
      normalized.startsWith("#")
    );
  };

  const expressionKind = (node) => {
    if (!node) {
      return undefined;
    }
    const expression = unwrapExpression(node);
    const moduleName = moduleNameFromCall(expression);
    if (moduleName === NEXT_NAVIGATION_MODULE) {
      return "namespace";
    }
    if (ts.isIdentifier(expression)) {
      const symbol = symbolAt(expression);
      if (symbol && navigationNamespaces.has(symbol)) {
        return "namespace";
      }
      if (symbol && historyObjects.has(symbol)) {
        return "history";
      }
      if (expression.text === "history") {
        const localDeclaration = symbol?.declarations?.some(
          (declaration) => !declaration.getSourceFile().isDeclarationFile,
        );
        if (!localDeclaration) {
          return "history";
        }
      }
    }
    if (
      (ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)) &&
      staticPropertyName(expression) === "history" &&
      ts.isIdentifier(propertyOwner(expression)) &&
      ["window", "globalThis"].includes(propertyOwner(expression).text)
    ) {
      return "history";
    }
    return undefined;
  };

  const bindFromNamespace = (sourceFile, name) => {
    let changed = false;
    if (ts.isIdentifier(name)) {
      return addSymbol(navigationNamespaces, name);
    }
    if (ts.isArrayBindingPattern(name)) {
      addViolation(
        sourceFile,
        name,
        "next-navigation-unresolved",
        "Array destructuring cannot prove that next/navigation is limited to read-only APIs.",
      );
      return false;
    }
    if (!ts.isObjectBindingPattern(name)) {
      return false;
    }

    for (const element of name.elements) {
      if (!ts.isBindingElement(element)) {
        continue;
      }
      if (element.dotDotDotToken && ts.isIdentifier(element.name)) {
        changed = addSymbol(navigationNamespaces, element.name) || changed;
        continue;
      }
      const importedName = element.propertyName
        ? ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : staticStringValue(element.propertyName)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
      if (!importedName || !READ_ONLY_NEXT_NAVIGATION_EXPORTS.has(importedName)) {
        addViolation(
          sourceFile,
          element,
          "next-navigation-api",
          importedName
            ? `next/navigation ${importedName} is not in the read-only API allowlist. Use the document navigation helpers.`
            : "A computed next/navigation export cannot be proven read-only.",
        );
      }
    }
    return changed;
  };

  for (const sourceFile of sourceFiles) {
    const visit = (node) => {
      if (
        ts.isImportDeclaration(node) ||
        ts.isExportDeclaration(node)
      ) {
        const moduleName =
          node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : undefined;
        const forbiddenReason = moduleName
          ? FORBIDDEN_ROUTER_MODULES.get(moduleName)
          : undefined;
        if (forbiddenReason) {
          addViolation(
            sourceFile,
            node.moduleSpecifier,
            "forbidden-router-module",
            `${forbiddenReason}. Use AppLink or the document navigation helpers.`,
          );
        } else if (
          moduleName === NEXT_NAVIGATION_MODULE &&
          ts.isImportDeclaration(node)
        ) {
          const importClause = node.importClause;
          if (importClause?.isTypeOnly) {
            ts.forEachChild(node, visit);
            return;
          }
          if (importClause?.name) {
            addSymbol(navigationNamespaces, importClause.name);
          }
          if (importClause?.namedBindings) {
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              addSymbol(navigationNamespaces, importClause.namedBindings.name);
            } else {
              for (const element of importClause.namedBindings.elements) {
                if (element.isTypeOnly) {
                  continue;
                }
                const importedName = (element.propertyName ?? element.name).text;
                if (!READ_ONLY_NEXT_NAVIGATION_EXPORTS.has(importedName)) {
                  addViolation(
                    sourceFile,
                    element,
                    "next-navigation-api",
                    `next/navigation ${importedName} is not in the read-only API allowlist. Use the document navigation helpers.`,
                  );
                }
              }
            }
          }
        } else if (
          moduleName === NEXT_NAVIGATION_MODULE &&
          ts.isExportDeclaration(node)
        ) {
          const exportClause = node.exportClause;
          const exportsUnapprovedApi =
            !exportClause ||
            ts.isNamespaceExport(exportClause) ||
            (ts.isNamedExports(exportClause) &&
              exportClause.elements.some(
                (element) =>
                  !element.isTypeOnly &&
                  !READ_ONLY_NEXT_NAVIGATION_EXPORTS.has(
                    (element.propertyName ?? element.name).text,
                  ),
              ));
          if (exportsUnapprovedApi) {
            addViolation(
              sourceFile,
              node,
              "next-navigation-api",
              "next/navigation re-exports must be limited to the read-only API allowlist.",
            );
          }
        }
      }

      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        const moduleName = node.moduleReference.expression.text;
        const forbiddenReason = FORBIDDEN_ROUTER_MODULES.get(moduleName);
        if (forbiddenReason) {
          addViolation(
            sourceFile,
            node,
            "forbidden-router-module",
            `${forbiddenReason}. Use AppLink or the document navigation helpers.`,
          );
        } else if (moduleName === NEXT_NAVIGATION_MODULE) {
          addSymbol(navigationNamespaces, node.name);
        }
      }

      if (ts.isCallExpression(node)) {
        const moduleName = moduleNameFromCall(node);
        const forbiddenReason = moduleName
          ? FORBIDDEN_ROUTER_MODULES.get(moduleName)
          : undefined;
        if (forbiddenReason) {
          addViolation(
            sourceFile,
            node,
            "forbidden-router-module",
            `${forbiddenReason}. Use AppLink or the document navigation helpers.`,
          );
        }
      }

      if (
        isIntrinsicAnchor(node) &&
        !allowedAnchors.has(resolve(sourceFile.fileName))
      ) {
        const dynamicAnchorException = dynamicRawAnchorException(
          sourceFile.fileName,
        );
        const attributes = node.attributes.properties;
        const hrefIndex = attributes.findIndex(
          (attribute) =>
            ts.isJsxAttribute(attribute) && attribute.name.getText() === "href",
        );
        const hrefAttribute = hrefIndex >= 0 ? attributes[hrefIndex] : undefined;
        const unsafeSpread = attributes.some(
          (attribute, index) =>
            ts.isJsxSpreadAttribute(attribute) &&
            (hrefIndex === -1 || index > hrefIndex),
        );
        const hrefExpression = jsxAttributeExpression(hrefAttribute);
        const candidates = hrefExpression
          ? resolveStringCandidates(hrefExpression)
          : undefined;
        const unsafeAnchor =
          unsafeSpread ||
          (hrefAttribute &&
            (!candidates || !candidates.every(isSafeRawAnchorCandidate)));
        const exceptionCoversDynamicHref =
          dynamicAnchorException &&
          hrefAttribute &&
          !unsafeSpread &&
          !candidates;
        if (unsafeAnchor && !exceptionCoversDynamicHref) {
          addViolation(
            sourceFile,
            hrefAttribute ?? node,
            candidates ? "raw-internal-anchor" : "raw-anchor-unresolved",
            "Raw anchors must have a statically provable external, mailto, tel, or hash href. Use AppLink for Clockhand screens.",
          );
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const sourceFile of sourceFiles) {
      const visit = (node) => {
        if (ts.isVariableDeclaration(node) && node.initializer) {
          const kind = expressionKind(node.initializer);
          const initializer = unwrapExpression(node.initializer);
          const initializerSymbol = ts.isIdentifier(initializer)
            ? symbolAt(initializer)
            : undefined;
          if (kind === "namespace") {
            changed = bindFromNamespace(sourceFile, node.name) || changed;
          } else if (kind === "history") {
            if (ts.isIdentifier(node.name)) {
              changed = addSymbol(historyObjects, node.name) || changed;
            } else if (ts.isObjectBindingPattern(node.name)) {
              for (const element of node.name.elements) {
                const methodName = element.propertyName
                  ? ts.isIdentifier(element.propertyName)
                    ? element.propertyName.text
                    : staticStringValue(element.propertyName)
                  : ts.isIdentifier(element.name)
                    ? element.name.text
                    : undefined;
                if (
                  methodName &&
                  HISTORY_METHODS.has(methodName) &&
                  ts.isIdentifier(element.name)
                ) {
                  const symbol = symbolAt(element.name);
                  if (symbol && !historyMethodBindings.has(symbol)) {
                    historyMethodBindings.set(symbol, methodName);
                    changed = true;
                  }
                }
              }
            }
          } else if (
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isPropertyAccessExpression(initializer) ||
              ts.isElementAccessExpression(initializer))
          ) {
            const member = initializer;
            const methodName = staticPropertyName(member);
            if (
              methodName &&
              HISTORY_METHODS.has(methodName) &&
              expressionKind(propertyOwner(member)) === "history"
            ) {
              const symbol = symbolAt(node.name);
              if (symbol && !historyMethodBindings.has(symbol)) {
                historyMethodBindings.set(symbol, methodName);
                changed = true;
              }
            }
          } else if (
            ts.isIdentifier(node.name) &&
            initializerSymbol &&
            historyMethodBindings.has(initializerSymbol)
          ) {
            const symbol = symbolAt(node.name);
            if (symbol && !historyMethodBindings.has(symbol)) {
              historyMethodBindings.set(
                symbol,
                historyMethodBindings.get(initializerSymbol),
              );
              changed = true;
            }
          }
        }

        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ) {
          const kind = expressionKind(node.right);
          if (kind === "namespace" && ts.isIdentifier(node.left)) {
            changed = addSymbol(navigationNamespaces, node.left) || changed;
          } else if (kind === "history" && ts.isIdentifier(node.left)) {
            changed = addSymbol(historyObjects, node.left) || changed;
          } else if (ts.isIdentifier(node.left) && ts.isIdentifier(node.right)) {
            const rightSymbol = symbolAt(node.right);
            const leftSymbol = symbolAt(node.left);
            if (
              rightSymbol &&
              leftSymbol &&
              historyMethodBindings.has(rightSymbol) &&
              !historyMethodBindings.has(leftSymbol)
            ) {
              historyMethodBindings.set(
                leftSymbol,
                historyMethodBindings.get(rightSymbol),
              );
              changed = true;
            }
          }
        }

        if (
          ts.isCallExpression(node) &&
          (ts.isPropertyAccessExpression(node.expression) ||
            ts.isElementAccessExpression(node.expression)) &&
          staticPropertyName(node.expression) === "then" &&
          expressionKind(propertyOwner(node.expression)) === "namespace"
        ) {
          const callback = node.arguments[0];
          if (
            callback &&
            (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
            callback.parameters[0]
          ) {
            changed =
              bindFromNamespace(sourceFile, callback.parameters[0].name) || changed;
          }
        }

        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }

  const climbTransparentExpression = (node) => {
    let expression = node;
    while (
      expression.parent &&
      ((ts.isAwaitExpression(expression.parent) &&
        expression.parent.expression === expression) ||
        (ts.isParenthesizedExpression(expression.parent) &&
          expression.parent.expression === expression) ||
        (ts.isAsExpression(expression.parent) &&
          expression.parent.expression === expression) ||
        (ts.isTypeAssertionExpression(expression.parent) &&
          expression.parent.expression === expression) ||
        (ts.isNonNullExpression(expression.parent) &&
          expression.parent.expression === expression) ||
        (ts.isSatisfiesExpression(expression.parent) &&
          expression.parent.expression === expression))
    ) {
      expression = expression.parent;
    }
    return expression;
  };

  const isDeclarationIdentifier = (node) => {
    const parent = node.parent;
    return (
      (ts.isVariableDeclaration(parent) && parent.name === node) ||
      (ts.isBindingElement(parent) && parent.name === node) ||
      (ts.isParameter(parent) && parent.name === node) ||
      (ts.isImportClause(parent) && parent.name === node) ||
      (ts.isNamespaceImport(parent) && parent.name === node) ||
      (ts.isImportSpecifier(parent) && parent.name === node) ||
      (ts.isImportEqualsDeclaration(parent) && parent.name === node)
    );
  };

  const isResolvedNamespaceConsumption = (node) => {
    if (ts.isIdentifier(node) && isDeclarationIdentifier(node)) {
      return true;
    }
    const expression = climbTransparentExpression(node);
    const parent = expression.parent;
    if (!parent) {
      return false;
    }
    if (
      (ts.isPropertyAccessExpression(parent) ||
        ts.isElementAccessExpression(parent)) &&
      parent.expression === expression
    ) {
      return true;
    }
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === expression
    ) {
      return true;
    }
    return (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === expression &&
      ts.isIdentifier(parent.left)
    );
  };

  const isAnalyzableDynamicThen = (member) => {
    const call = member.parent;
    const callback = ts.isCallExpression(call) && call.expression === member
      ? call.arguments[0]
      : undefined;
    return Boolean(
      callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        callback.parameters[0],
    );
  };

  const historyMethodFromCall = (node) => {
    if (!ts.isCallExpression(node)) {
      return undefined;
    }
    const callee = unwrapExpression(node.expression);
    if (ts.isIdentifier(callee)) {
      const symbol = symbolAt(callee);
      return symbol ? historyMethodBindings.get(symbol) : undefined;
    }
    if (
      (ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)) &&
      expressionKind(propertyOwner(callee)) === "history"
    ) {
      const methodName = staticPropertyName(callee);
      if (!methodName) {
        return "unresolved";
      }
      return HISTORY_METHODS.has(methodName) ? methodName : undefined;
    }
    return undefined;
  };

  for (const sourceFile of sourceFiles) {
    const visit = (node) => {
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        expressionKind(propertyOwner(node)) === "namespace"
      ) {
        const apiName = staticPropertyName(node);
        const allowed =
          (apiName && READ_ONLY_NEXT_NAVIGATION_EXPORTS.has(apiName)) ||
          (apiName === "then" && isAnalyzableDynamicThen(node));
        if (!allowed) {
          addViolation(
            sourceFile,
            node,
            apiName ? "next-navigation-api" : "next-navigation-unresolved",
            apiName
              ? `next/navigation ${apiName} is not in the read-only API allowlist. Use the document navigation helpers.`
              : "A computed next/navigation export cannot be proven read-only.",
          );
        }
      }
      if (ts.isIdentifier(node)) {
        const symbol = symbolAt(node);
        if (
          symbol &&
          navigationNamespaces.has(symbol) &&
          !isResolvedNamespaceConsumption(node)
        ) {
          addViolation(
            sourceFile,
            node,
            "next-navigation-unresolved",
            "A next/navigation namespace value escaped analysis and cannot be proven read-only.",
          );
        }
      }
      if (
        ts.isCallExpression(node) &&
        moduleNameFromCall(node) === NEXT_NAVIGATION_MODULE &&
        !isResolvedNamespaceConsumption(node)
      ) {
        addViolation(
          sourceFile,
          node,
          "next-navigation-unresolved",
          "A dynamic next/navigation module value escaped analysis and cannot be proven read-only.",
        );
      }
      if (ts.isCallExpression(node)) {
        const historyMethod = historyMethodFromCall(node);
        if (historyMethod === "unresolved") {
          addViolation(
            sourceFile,
            node.expression,
            "history-navigation-unresolved",
            "A computed History method cannot be proven to preserve the current static screen.",
          );
        } else if (historyMethod) {
          const hasSpreadArgument = node.arguments.some(ts.isSpreadElement);
          const url = node.arguments[2];
          const candidates = url ? resolveStringCandidates(url) : undefined;
          if (
            hasSpreadArgument ||
            (url &&
              (!candidates || !candidates.every(isSafeHistoryCandidate)))
          ) {
            addViolation(
              sourceFile,
              url ?? node,
              "history-cross-screen-navigation",
              `history.${historyMethod} must omit its URL or use a statically provable query/hash-only URL.`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return violations.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.line - right.line ||
      left.column - right.column,
  );
}

export function assertRuntimeNavigationContract(options) {
  const violations = scanRuntimeNavigationContract(options);
  if (violations.length > 0) {
    throw new Error(
      `Static screen navigation contract failed:\n${violations
        .map(formatViolation)
        .join("\n")}`,
    );
  }
}

function parseSource(path) {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function exportedVariable(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === name,
      ),
  );
}

function exportedFunction(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
  );
}

function descendants(node) {
  const result = [];
  const visit = (child) => {
    result.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return result;
}

function verifyAppLinkContract(appLinkPath) {
  const sourceFile = parseSource(appLinkPath);
  const appLinkStatement = exportedVariable(sourceFile, "AppLink");
  if (!appLinkStatement) {
    throw new Error("AppLink must be an exported component.");
  }

  const helperImport = sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (statement) =>
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "@/lib/navigation",
    );
  const helperName =
    helperImport?.importClause?.namedBindings &&
    ts.isNamedImports(helperImport.importClause.namedBindings)
      ? helperImport.importClause.namedBindings.elements.find(
          (element) =>
            (element.propertyName ?? element.name).text === "toStaticScreenHref",
        )?.name.text
      : undefined;
  if (!helperName) {
    throw new Error("AppLink must import toStaticScreenHref from the navigation contract.");
  }

  const anchors = descendants(appLinkStatement).filter(isIntrinsicAnchor);
  const hasDocumentAnchor = anchors.some((anchor) => {
    const href = jsxAttributeExpression(jsxAttribute(anchor, "href"));
    const navigationMarker = jsxAttribute(anchor, "data-clockhand-navigation");
    const markerValue = navigationMarker?.initializer;
    return (
      href &&
      ts.isCallExpression(href) &&
      ts.isIdentifier(href.expression) &&
      href.expression.text === helperName &&
      href.arguments.length === 1 &&
      ts.isIdentifier(href.arguments[0]) &&
      href.arguments[0].text === "href" &&
      markerValue &&
      ts.isStringLiteral(markerValue) &&
      markerValue.text === "document"
    );
  });
  if (!hasDocumentAnchor) {
    throw new Error(
      "AppLink must pass its href through toStaticScreenHref and mark the resulting anchor as document navigation.",
    );
  }
}

function findRouteSet(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "staticScreenPaths" &&
        declaration.initializer &&
        ts.isNewExpression(declaration.initializer) &&
        ts.isIdentifier(declaration.initializer.expression) &&
        declaration.initializer.expression.text === "Set"
      ) {
        const routes = declaration.initializer.arguments?.[0];
        if (routes && ts.isArrayLiteralExpression(routes)) {
          return {
            declaration,
            routes: new Set(
              routes.elements
                .map((element) => staticStringValue(element))
                .filter((route) => route !== undefined),
            ),
          };
        }
      }
    }
  }
  return undefined;
}

function hasCall(node, predicate) {
  return descendants(node).some(
    (descendant) => ts.isCallExpression(descendant) && predicate(descendant),
  );
}

function isNamedCall(node, ownerName, methodName) {
  return (
    (ts.isPropertyAccessExpression(node.expression) ||
      ts.isElementAccessExpression(node.expression)) &&
    staticPropertyName(node.expression) === methodName &&
    ts.isIdentifier(propertyOwner(node.expression)) &&
    propertyOwner(node.expression).text === ownerName
  );
}

function isNormalizationCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "toStaticScreenHref" &&
    node.arguments.length === 1 &&
    ts.isIdentifier(node.arguments[0]) &&
    node.arguments[0].text === "href"
  );
}

function verifyNavigationHelpers(navigationPath, internalRoutes) {
  const sourceFile = parseSource(navigationPath);
  const routeSet = findRouteSet(sourceFile);
  if (!routeSet) {
    throw new Error("The navigation contract must define staticScreenPaths as a Set.");
  }
  for (const route of internalRoutes) {
    if (!routeSet.routes.has(route)) {
      throw new Error(`The document navigation route map is missing ${route}.`);
    }
  }

  const normalizer = exportedFunction(sourceFile, "toStaticScreenHref");
  if (
    !normalizer ||
    !hasCall(
      normalizer,
      (call) =>
        isNamedCall(call, "staticScreenPaths", "has") &&
        call.arguments.length === 1,
    )
  ) {
    throw new Error(
      "toStaticScreenHref must validate paths against the static screen route map.",
    );
  }

  for (const [functionName, methodName] of [
    ["navigateToScreen", "assign"],
    ["replaceWithScreen", "replace"],
  ]) {
    const helper = exportedFunction(sourceFile, functionName);
    const valid =
      helper &&
      hasCall(
        helper,
        (call) =>
          isNamedCall(call, "navigation", methodName) &&
          call.arguments.length === 1 &&
          isNormalizationCall(call.arguments[0]),
      );
    if (!valid) {
      throw new Error(
        `${functionName} must pass toStaticScreenHref(href) to navigation.${methodName}.`,
      );
    }
  }
}

export function assertDesktopNavigationContract({
  desktopDir,
  internalRoutes = STATIC_SCREEN_PATHS,
}) {
  const appLinkPath = join(desktopDir, "components", "app-link.tsx");
  const sourcePaths = ["app", "components", "lib"].flatMap((directory) =>
    listSourceFiles(join(desktopDir, directory)),
  );
  assertRuntimeNavigationContract({
    sourcePaths,
    internalRoutes,
    allowedRawAnchorPaths: [appLinkPath],
  });
  verifyAppLinkContract(appLinkPath);
  verifyNavigationHelpers(
    join(desktopDir, "lib", "navigation.ts"),
    internalRoutes,
  );
}
