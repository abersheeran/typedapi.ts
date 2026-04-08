"use strict";

const ts = require("typescript");

/**
 * @param {ts.Program} program
 * @returns {ts.TransformerFactory<ts.SourceFile>}
 */
module.exports = function (program) {
  const checker = program.getTypeChecker();

  return (context) => {
    const factory = context.factory;

    return (sourceFile) => {
      let apiImportModuleSpecifier = null;
      let middlewareImportModuleSpecifier = null;
      let injectImportModuleSpecifier = null;

      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

        const clause = statement.importClause;
        if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
          continue;
        }

        for (const element of clause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (importedName === "api") {
            apiImportModuleSpecifier = statement.moduleSpecifier.text;
          }
          if (importedName === "middleware") {
            middlewareImportModuleSpecifier = statement.moduleSpecifier.text;
          }
          if (importedName === "inject") {
            injectImportModuleSpecifier = statement.moduleSpecifier.text;
          }
        }
      }

      if (
        !apiImportModuleSpecifier &&
        !middlewareImportModuleSpecifier &&
        !injectImportModuleSpecifier
      ) {
        return sourceFile;
      }

      const visit = (node) => {
        const next = ts.visitEachChild(node, visit, context);
        if (!ts.isCallExpression(next)) {
          return next;
        }
        const transformedApiCall = transformApiCall(next);
        if (transformedApiCall !== next) {
          return transformedApiCall;
        }
        const transformedMiddlewareCall = transformMiddlewareCall(next);
        if (transformedMiddlewareCall !== next) {
          return transformedMiddlewareCall;
        }
        return transformInjectCall(next);
      };

      function isOurApiCall(node) {
        return isOurImportedCall(node, "api", apiImportModuleSpecifier);
      }

      function isOurMiddlewareCall(node) {
        return isOurImportedCall(
          node,
          "middleware",
          middlewareImportModuleSpecifier,
        );
      }

      function isOurInjectCall(node) {
        return isOurImportedCall(node, "inject", injectImportModuleSpecifier);
      }

      function isOurImportedCall(node, name, moduleSpecifier) {
        if (!moduleSpecifier) {
          return false;
        }

        if (!ts.isIdentifier(node.expression) || node.expression.text !== name) {
          return false;
        }

        const symbol = checker.getSymbolAtLocation(node.expression);
        if (!symbol) {
          return false;
        }

        for (const declaration of symbol.declarations ?? []) {
          if (!ts.isImportSpecifier(declaration)) {
            continue;
          }

          const importDeclaration = declaration.parent.parent.parent;
          if (
            ts.isImportDeclaration(importDeclaration) &&
            ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
            importDeclaration.moduleSpecifier.text === moduleSpecifier
          ) {
            return true;
          }
        }

        return false;
      }

      function transformApiCall(node) {
        if (!isOurApiCall(node) || node.arguments.length < 2) {
          return node;
        }

        const [config, handler, existingOptions] = node.arguments;
        const hasParameters = hasOptionProperty(existingOptions, "parameters");
        const hasResponses = hasOptionProperty(existingOptions, "responses");
        const hasInject = hasOptionProperty(existingOptions, "inject");
        const injectedProperties = [];

        if (!hasParameters) {
          const paramType = getHandlerParamType(handler);
          if (paramType) {
            const metadata = extractParamMetadata(paramType);
            if (metadata) {
              injectedProperties.push(
                factory.createPropertyAssignment(
                  factory.createIdentifier("parameters"),
                  toLiteral(metadata),
                ),
              );
            }
          }
        }

        if (!hasResponses) {
          const metadata = extractResponseMetadata(handler);
          if (metadata) {
            injectedProperties.push(
              factory.createPropertyAssignment(
                factory.createIdentifier("responses"),
                toLiteral(metadata),
              ),
            );
          }
        }

        if (!hasInject) {
          const injectMetadata = extractInjectMetadata(handler);
          if (injectMetadata) {
            const properties = injectMetadata.map(({ paramName, identifier }) =>
              factory.createPropertyAssignment(
                factory.createIdentifier(paramName),
                identifier,
              ),
            );
            injectedProperties.push(
              factory.createPropertyAssignment(
                factory.createIdentifier("inject"),
                factory.createObjectLiteralExpression(properties, true),
              ),
            );
          }
        }

        if (injectedProperties.length === 0) {
          return node;
        }

        const optionsObject = buildOptionsObject(
          existingOptions,
          injectedProperties,
        );
        const nextArguments = existingOptions
          ? [config, handler, optionsObject, ...node.arguments.slice(3)]
          : [config, handler, optionsObject];

        return factory.updateCallExpression(
          node,
          node.expression,
          node.typeArguments,
          nextArguments,
        );
      }

      function transformMiddlewareCall(node) {
        if (!isOurMiddlewareCall(node) || node.arguments.length === 0) {
          return node;
        }

        const [handler, existingOptions] = node.arguments;
        const hasParameters = hasOptionProperty(existingOptions, "parameters");
        const hasResponses = hasOptionProperty(existingOptions, "responses");
        if (hasParameters && hasResponses) {
          return node;
        }

        const injectedProperties = [];

        if (!hasParameters) {
          const paramType = getMiddlewareParamType(handler);
          if (paramType) {
            const metadata = extractParamMetadata(paramType);
            if (metadata) {
              injectedProperties.push(
                factory.createPropertyAssignment(
                  factory.createIdentifier("parameters"),
                  toLiteral(metadata),
                ),
              );
            }
          }
        }

        if (!hasResponses) {
          const metadata = extractMiddlewareResponseMetadata(handler);
          if (metadata) {
            injectedProperties.push(
              factory.createPropertyAssignment(
                factory.createIdentifier("responses"),
                toLiteral(metadata),
              ),
            );
          }
        }

        if (injectedProperties.length === 0) {
          return node;
        }

        const optionsObject = buildMetadataOptionsObject(
          existingOptions,
          injectedProperties,
        );
        const nextArguments = existingOptions
          ? [handler, optionsObject, ...node.arguments.slice(2)]
          : [handler, optionsObject];

        return factory.updateCallExpression(
          node,
          node.expression,
          node.typeArguments,
          nextArguments,
        );
      }

      function transformInjectCall(node) {
        if (!isOurInjectCall(node) || node.arguments.length === 0) {
          return node;
        }

        const [handler, existingOptions] = node.arguments;
        const hasParameters = hasOptionProperty(existingOptions, "parameters");
        const hasResponses = hasOptionProperty(existingOptions, "responses");
        if (hasParameters && hasResponses) {
          return node;
        }

        const injectedProperties = [];

        if (!hasParameters) {
          const paramType = getHandlerParamType(handler);
          if (paramType) {
            const metadata = extractParamMetadata(paramType);
            if (metadata) {
              injectedProperties.push(
                factory.createPropertyAssignment(
                  factory.createIdentifier("parameters"),
                  toLiteral(metadata),
                ),
              );
            }
          }
        }

        if (!hasResponses) {
          const metadata = extractResponseMetadata(handler);
          if (metadata) {
            injectedProperties.push(
              factory.createPropertyAssignment(
                factory.createIdentifier("responses"),
                toLiteral(metadata),
              ),
            );
          }
        }

        if (injectedProperties.length === 0) {
          return node;
        }

        const optionsObject = buildMetadataOptionsObject(
          existingOptions,
          injectedProperties,
        );
        const nextArguments = existingOptions
          ? [handler, optionsObject, ...node.arguments.slice(2)]
          : [handler, optionsObject];

        return factory.updateCallExpression(
          node,
          node.expression,
          node.typeArguments,
          nextArguments,
        );
      }

      function hasOptionProperty(node, name) {
        if (!node || !ts.isObjectLiteralExpression(node)) {
          return false;
        }

        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property)) {
            continue;
          }
          if (getPropertyNameText(property.name) === name) {
            return true;
          }
        }

        return false;
      }

      function buildOptionsObject(existingOptions, injectedProperties) {
        if (!existingOptions) {
          return factory.createObjectLiteralExpression(injectedProperties, true);
        }

        if (ts.isObjectLiteralExpression(existingOptions)) {
          return factory.createObjectLiteralExpression(
            [...existingOptions.properties, ...injectedProperties],
            true,
          );
        }

        if (isValidateExpression(existingOptions)) {
          return factory.createObjectLiteralExpression(
            [
              factory.createPropertyAssignment(
                factory.createIdentifier("validate"),
                existingOptions,
              ),
              ...injectedProperties,
            ],
            true,
          );
        }

        return factory.createObjectLiteralExpression(
          [...injectedProperties, factory.createSpreadAssignment(existingOptions)],
          true,
        );
      }

      function buildMetadataOptionsObject(existingOptions, injectedProperties) {
        if (!existingOptions) {
          return factory.createObjectLiteralExpression(injectedProperties, true);
        }

        if (ts.isObjectLiteralExpression(existingOptions)) {
          return factory.createObjectLiteralExpression(
            [...existingOptions.properties, ...injectedProperties],
            true,
          );
        }

        return factory.createObjectLiteralExpression(
          [...injectedProperties, factory.createSpreadAssignment(existingOptions)],
          true,
        );
      }

      function isValidateExpression(node) {
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          return true;
        }

        const type = checker.getTypeAtLocation(node);
        return type.getCallSignatures().length > 0;
      }

      function getPropertyNameText(name) {
        if (!name) {
          return null;
        }
        if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
          return name.text;
        }
        return null;
      }

      function getSymbolType(symbol) {
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
        if (declaration) {
          return checker.getTypeOfSymbolAtLocation(symbol, declaration);
        }

        if (typeof checker.getDeclaredTypeOfSymbol === "function") {
          return checker.getDeclaredTypeOfSymbol(symbol);
        }

        return null;
      }

      function getHandlerParamType(handler) {
        if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
          const [firstParam] = handler.parameters;
          if (!firstParam?.type) {
            return null;
          }
          return checker.getTypeAtLocation(firstParam);
        }

        const type = checker.getTypeAtLocation(handler);
        const [signature] = type.getCallSignatures();
        if (!signature) {
          return null;
        }

        const [parameter] = signature.getParameters();
        if (!parameter) {
          return null;
        }

        return checker.getTypeOfSymbolAtLocation(parameter, handler);
      }

      function getHandlerParamTypeNode(handler) {
        if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) {
          return null;
        }

        const [firstParam] = handler.parameters;
        return firstParam?.type ?? null;
      }

      function getHandlerReturnType(handler) {
        if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
          const signature = checker.getSignatureFromDeclaration(handler);
          return signature ? checker.getReturnTypeOfSignature(signature) : null;
        }

        const type = checker.getTypeAtLocation(handler);
        const [signature] = type.getCallSignatures();
        return signature ? checker.getReturnTypeOfSignature(signature) : null;
      }

      function getMiddlewareParamType(handler) {
        if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
          const signature = checker.getSignatureFromDeclaration(handler);
          if (!signature) {
            return null;
          }

          const returnType = checker.getReturnTypeOfSignature(signature);
          const callSignatures = returnType.getCallSignatures();
          if (!callSignatures.length) {
            return null;
          }

          const innerSignature = callSignatures[0];
          const [paramSymbol] = innerSignature.getParameters();
          if (!paramSymbol) {
            return null;
          }

          return checker.getTypeOfSymbolAtLocation(paramSymbol, handler);
        }

        const type = checker.getTypeAtLocation(handler);
        const [signature] = type.getCallSignatures();
        if (!signature) {
          return null;
        }

        const returnType = checker.getReturnTypeOfSignature(signature);
        const callSignatures = returnType.getCallSignatures();
        if (!callSignatures.length) {
          return null;
        }

        const innerSignature = callSignatures[0];
        const [paramSymbol] = innerSignature.getParameters();
        if (!paramSymbol) {
          return null;
        }

        return checker.getTypeOfSymbolAtLocation(paramSymbol, handler);
      }

      function getMiddlewareReturnType(handler) {
        if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
          const signature = checker.getSignatureFromDeclaration(handler);
          if (!signature) {
            return null;
          }

          const returnType = checker.getReturnTypeOfSignature(signature);
          const callSignatures = returnType.getCallSignatures();
          if (!callSignatures.length) {
            return null;
          }

          return checker.getReturnTypeOfSignature(callSignatures[0]);
        }

        const type = checker.getTypeAtLocation(handler);
        const [signature] = type.getCallSignatures();
        if (!signature) {
          return null;
        }

        const returnType = checker.getReturnTypeOfSignature(signature);
        const callSignatures = returnType.getCallSignatures();
        if (!callSignatures.length) {
          return null;
        }

        return checker.getReturnTypeOfSignature(callSignatures[0]);
      }

      function unwrapPromise(type) {
        const target = type.target;
        if (target?.symbol?.name === "Promise") {
          const typeArgs = checker.getTypeArguments?.(type) ?? type.typeArguments;
          if (typeArgs?.length) {
            return typeArgs[0];
          }
        }

        return type;
      }

      function extractParamMetadata(paramType) {
        const properties = paramType.getProperties();
        if (properties.length === 0) {
          return null;
        }

        const entries = [];
        const bodyProperties = {};
        const bodyRequired = [];
        let hasAnyBrand = false;

        for (const property of properties) {
          const propertyType = getSymbolType(property);
          if (!propertyType) {
            continue;
          }
          const location = getParamLocation(propertyType);
          if (!location) {
            continue;
          }

          hasAnyBrand = true;

          const schema = { type: getBaseJsonType(propertyType) };
          const meta = extractMeta(propertyType, location);
          const isOptional = (property.flags & ts.SymbolFlags.Optional) !== 0;

          if (meta.title !== undefined) {
            schema.title = meta.title;
          }
          if (location === "body") {
            if (meta.description !== undefined) {
              schema.description = meta.description;
            }
            if (meta.example !== undefined) {
              schema.example = meta.example;
            }

            bodyProperties[property.name] = schema;
            if (!isOptional) {
              bodyRequired.push(property.name);
            }
            continue;
          }

          const entry = {
            name: meta.alias ?? property.name,
            in: location,
            required: location === "path" ? true : !isOptional,
            schema,
          };

          if (meta.description !== undefined) {
            entry.description = meta.description;
          }
          if (meta.example !== undefined) {
            entry.example = meta.example;
          }
          if (meta.deprecated === true) {
            entry.deprecated = true;
          }

          entries.push(entry);
        }

        if (!hasAnyBrand) {
          return null;
        }

        const result = { __entries: entries };
        if (Object.keys(bodyProperties).length > 0) {
          result.__body = {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: bodyProperties,
                  ...(bodyRequired.length > 0 ? { required: bodyRequired } : {}),
                },
              },
            },
          };
        }

        return result;
      }

      function extractResponseMetadata(handler) {
        const returnType = getHandlerReturnType(handler);
        if (!returnType) {
          return null;
        }

        return extractResponseMetadataFromType(returnType);
      }

      function extractInjectMetadata(handler) {
        const paramTypeNode = getHandlerParamTypeNode(handler);
        if (!paramTypeNode || !ts.isTypeLiteralNode(paramTypeNode)) {
          return null;
        }

        const injects = [];

        for (const member of paramTypeNode.members) {
          if (!ts.isPropertySignature(member) || !member.type) {
            continue;
          }

          const paramName = getPropertyNameText(member.name);
          if (!paramName) {
            continue;
          }

          const type = checker.getTypeAtLocation(member.type);
          if (!hasTypeProperty(type, "__inject")) {
            continue;
          }

          if (!ts.isTypeReferenceNode(member.type)) {
            continue;
          }

          const [typeArgument] = member.type.typeArguments ?? [];
          if (!typeArgument || !ts.isTypeQueryNode(typeArgument)) {
            continue;
          }

          const { exprName } = typeArgument;
          if (!ts.isIdentifier(exprName)) {
            continue;
          }

          injects.push({
            paramName,
            identifier: factory.createIdentifier(exprName.text),
          });
        }

        return injects.length > 0 ? injects : null;
      }

      function extractMiddlewareResponseMetadata(handler) {
        const returnType = getMiddlewareReturnType(handler);
        if (!returnType) {
          return null;
        }

        return extractResponseMetadataFromType(returnType, true);
      }

      function extractResponseMetadataFromType(
        returnType,
        filterUnbrandedUnionMembers = false,
      ) {
        const resolvedType = unwrapPromise(returnType);
        const members = resolvedType.isUnion()
          ? filterUnbrandedUnionMembers
            ? resolvedType.types.filter((member) =>
                hasTypeProperty(member, "__response"),
              )
            : resolvedType.types
          : [resolvedType];
        const responses = [];

        for (const member of members) {
          if (!hasTypeProperty(member, "__response")) {
            continue;
          }

          const responseType = findBrandType(member, "__response");
          if (!responseType) {
            continue;
          }

          const statusProperty = responseType.getProperty("status");
          const statusType = statusProperty ? getSymbolType(statusProperty) : null;
          const statusValue = getLiteralValue(statusType);
          const headers = {};

          const headersProperty = responseType.getProperty("headers");
          const headersType = headersProperty ? getSymbolType(headersProperty) : null;
          if (headersType) {
            for (const property of headersType.getProperties()) {
              const propertyType = getSymbolType(property);
              const value = getLiteralValue(propertyType);
              if (typeof value === "string") {
                headers[property.name] = value;
              }
            }
          }

          const bodyProperty = responseType.getProperty("body");
          let bodySchema;
          if (bodyProperty) {
            const bodyType = getSymbolType(bodyProperty);
            if (bodyType) {
              const f = bodyType.flags;
              if (
                f & ts.TypeFlags.Null ||
                f & ts.TypeFlags.Undefined ||
                f & ts.TypeFlags.Void
              ) {
                bodySchema = {};
              } else {
                bodySchema = typeToJsonSchema(bodyType, 0);
              }
            } else {
              bodySchema = typeToJsonSchema(getResponseBodyType(member), 0);
            }
          } else {
            bodySchema = typeToJsonSchema(getResponseBodyType(member), 0);
          }

          responses.push({
            status: typeof statusValue === "number" ? statusValue : 200,
            headers,
            schema: bodySchema,
          });
        }

        return responses.length > 0 ? { __responses: responses } : null;
      }

      function getResponseBodyType(type) {
        if (!type.isIntersection()) {
          return type;
        }

        const bodyTypes = type.types.filter(
          (item) => !hasTypeProperty(item, "__response"),
        );
        if (bodyTypes.length === 1) {
          return bodyTypes[0];
        }

        return type;
      }

      function getParamLocation(type) {
        if (hasTypeProperty(type, "__inject")) {
          return null;
        }
        if (hasTypeProperty(type, "__path")) {
          return "path";
        }
        if (hasTypeProperty(type, "__query")) {
          return "query";
        }
        if (hasTypeProperty(type, "__header")) {
          return "header";
        }
        if (hasTypeProperty(type, "__cookie")) {
          return "cookie";
        }
        if (hasTypeProperty(type, "__body")) {
          return "body";
        }
        return null;
      }

      function hasTypeProperty(type, name) {
        if (type.getProperty(name)) {
          return true;
        }
        if (type.isIntersection() || type.isUnion()) {
          return type.types.some((item) => hasTypeProperty(item, name));
        }
        return false;
      }

      function getBaseJsonType(type) {
        if (type.isIntersection() || type.isUnion()) {
          for (const item of type.types) {
            const resolved = getBaseJsonTypeForSingle(item);
            if (resolved) {
              return resolved;
            }
          }
        }

        return getBaseJsonTypeForSingle(type) ?? "string";
      }

      function getBaseJsonTypeForSingle(type) {
        const flags = type.flags;
        if (flags & ts.TypeFlags.Number || flags & ts.TypeFlags.NumberLiteral) {
          return "number";
        }
        if (flags & ts.TypeFlags.String || flags & ts.TypeFlags.StringLiteral) {
          return "string";
        }
        if (flags & ts.TypeFlags.Boolean || flags & ts.TypeFlags.BooleanLiteral) {
          return "boolean";
        }
        return null;
      }

      function extractMeta(type, location) {
        const brandKeys = {
          path: "__path",
          query: "__query",
          header: "__header",
          cookie: "__cookie",
          body: "__body",
        };
        const brandKey = brandKeys[location];
        const brandType = findBrandType(type, brandKey);
        if (!brandType) {
          return {};
        }

        const meta = {};
        for (const property of brandType.getProperties()) {
          const propertyType = getSymbolType(property);
          if (!propertyType) {
            continue;
          }
          const value = getLiteralValue(propertyType);
          if (value !== undefined) {
            meta[property.name] = value;
          }
        }

        return meta;
      }

      function findBrandType(type, brandKey) {
        const brandSymbol = type.getProperty(brandKey);
        if (brandSymbol) {
          const brandType = getSymbolType(brandSymbol);
          if (!brandType) {
            return null;
          }

          if (brandType.isUnion() || brandType.isIntersection()) {
            for (const item of brandType.types) {
              if (item.getProperties().length > 0) {
                return item;
              }
            }
          }

          return brandType;
        }

        if (type.isIntersection() || type.isUnion()) {
          for (const item of type.types) {
            const resolved = findBrandType(item, brandKey);
            if (resolved) {
              return resolved;
            }
          }
        }

        return null;
      }

      function getLiteralValue(type) {
        if (type.isStringLiteral()) {
          return type.value;
        }
        if (type.isNumberLiteral()) {
          return type.value;
        }
        if (type.flags & ts.TypeFlags.BooleanLiteral) {
          return type.intrinsicName === "true";
        }
        if (type.isUnion() || type.isIntersection()) {
          for (const item of type.types) {
            const resolved = getLiteralValue(item);
            if (resolved !== undefined) {
              return resolved;
            }
          }
        }
        return undefined;
      }

      function typeToJsonSchema(type, depth) {
        if (depth > 10) {
          return {};
        }

        const flags = type.flags;

        if (
          flags & ts.TypeFlags.Any ||
          flags & ts.TypeFlags.Unknown ||
          flags & ts.TypeFlags.Never
        ) {
          return {};
        }

        if (flags & ts.TypeFlags.Void || flags & ts.TypeFlags.Undefined) {
          return {};
        }
        if (flags & ts.TypeFlags.Null) {
          return { type: "null" };
        }

        if (type.isStringLiteral()) {
          return { type: "string", const: type.value };
        }
        if (type.isNumberLiteral()) {
          return { type: "number", const: type.value };
        }
        if (flags & ts.TypeFlags.BooleanLiteral) {
          return {
            type: "boolean",
            const: type.intrinsicName === "true",
          };
        }

        if (flags & ts.TypeFlags.String) {
          return { type: "string" };
        }
        if (flags & ts.TypeFlags.Number) {
          return { type: "number" };
        }
        if (flags & ts.TypeFlags.Boolean) {
          return { type: "boolean" };
        }

        if (type.isUnion()) {
          const members = type.types.filter(
            (item) => !(item.flags & ts.TypeFlags.Undefined),
          );
          if (members.length === 0) {
            return {};
          }
          if (members.length === 1) {
            return typeToJsonSchema(members[0], depth);
          }

          const nonNull = members.filter(
            (item) => !(item.flags & ts.TypeFlags.Null),
          );
          if (nonNull.length < members.length && nonNull.length === 1) {
            return {
              oneOf: [
                typeToJsonSchema(nonNull[0], depth),
                { type: "null" },
              ],
            };
          }

          if (
            members.length === 2 &&
            members.every((item) => item.flags & ts.TypeFlags.BooleanLiteral)
          ) {
            return { type: "boolean" };
          }

          return {
            oneOf: members.map((item) => typeToJsonSchema(item, depth)),
          };
        }

        if (isArrayType(type)) {
          const elementType = getArrayElementType(type);
          return elementType
            ? {
                type: "array",
                items: typeToJsonSchema(elementType, depth + 1),
              }
            : { type: "array" };
        }

        if (type.isIntersection()) {
          return typeToObjectSchema(type, depth);
        }

        if (flags & ts.TypeFlags.Object) {
          const symbol = type.getSymbol?.() ?? type.symbol;
          if (symbol?.name === "Date") {
            return { type: "string", format: "date-time" };
          }

          return typeToObjectSchema(type, depth);
        }

        return {};
      }

      function typeToObjectSchema(type, depth) {
        const properties = {};
        const required = [];

        for (const property of type.getProperties()) {
          if (property.name.startsWith("__")) {
            continue;
          }

          const propertyType = getSymbolType(property);
          if (!propertyType) {
            continue;
          }

          const schema = typeToJsonSchema(propertyType, depth + 1);
          if (Object.keys(schema).length === 0) {
            continue;
          }

          properties[property.name] = schema;
          if (!(property.flags & ts.SymbolFlags.Optional)) {
            required.push(property.name);
          }
        }

        if (Object.keys(properties).length === 0) {
          return {};
        }

        const schema = {
          type: "object",
          properties,
        };

        if (required.length > 0) {
          schema.required = required;
        }

        return schema;
      }

      function isArrayType(type) {
        const target = type.target;
        return (
          target?.symbol?.name === "Array" ||
          target?.symbol?.name === "ReadonlyArray"
        );
      }

      function getArrayElementType(type) {
        const typeArgs = checker.getTypeArguments?.(type) ?? type.typeArguments;
        return typeArgs?.[0];
      }

      function toLiteral(value) {
        if (value === null || value === undefined) {
          return factory.createNull();
        }
        if (typeof value === "string") {
          return factory.createStringLiteral(value);
        }
        if (typeof value === "number") {
          return factory.createNumericLiteral(value);
        }
        if (typeof value === "boolean") {
          return value ? factory.createTrue() : factory.createFalse();
        }
        if (Array.isArray(value)) {
          return factory.createArrayLiteralExpression(
            value.map((item) => toLiteral(item)),
            true,
          );
        }
        if (typeof value === "object") {
          const properties = [];

          for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined) {
              continue;
            }

            properties.push(
              factory.createPropertyAssignment(
                /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
                  ? factory.createIdentifier(key)
                  : factory.createStringLiteral(key),
                toLiteral(entry),
              ),
            );
          }

          return factory.createObjectLiteralExpression(properties, true);
        }

        return factory.createNull();
      }

      return ts.visitNode(sourceFile, visit);
    };
  };
};
