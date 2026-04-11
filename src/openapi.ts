import { routeParametersSymbol, routeResponsesSymbol } from "./api.js";
import {
  injectableParametersSymbol,
  injectableResponsesSymbol,
} from "./inject.js";
import {
  middlewareParametersSymbol,
  middlewareResponsesSymbol,
  middlewareInjectSymbol,
} from "./middleware.js";
import type { AnyRoute } from "./types.js";

interface OpenAPIConfig {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  routes: AnyRoute[];
  servers?: { url: string; description?: string }[];
}

type JsonSchema = Record<string, any>;

type JsonApplication = {
  schema?: JsonSchema;
  schemas?: JsonSchema[];
  components?: {
    schemas?: Record<string, JsonSchema>;
  };
};

interface ParamMetadata {
  in?: string;
  alias?: string;
  title?: string;
  description?: string;
  example?: unknown;
  deprecated?: boolean;
}

function toOpenAPIPath(path: string): string {
  return path.replace(/:(\w+)/g, "{$1}");
}

function getPathParameterNames(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)]
    .map((match) => match[1])
    .filter((name): name is string => typeof name === "string");
}

function buildPathParameters(path: string) {
  return getPathParameterNames(path).map((name) => ({
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string" },
  }));
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}

function getSchemaRefName(schema: JsonSchema): string | undefined {
  const ref = schema.$ref;
  if (typeof ref !== "string") {
    return undefined;
  }

  const prefix = "#/components/schemas/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
}

function stripParameterMeta(schema: JsonSchema): JsonSchema {
  const next = { ...schema };
  delete next.$ref;
  delete next.title;
  delete next.description;
  delete next.deprecated;
  delete next.example;
  return next;
}

function getParameterLocation(
  name: string,
  refName: string | undefined,
  pathParameters: Set<string>,
): "path" | "query" | "header" | "cookie" | "body" | undefined {
  if (refName?.startsWith("Path")) {
    return "path";
  }
  if (refName?.startsWith("Query")) {
    return "query";
  }
  if (refName?.startsWith("Header")) {
    return "header";
  }
  if (refName?.startsWith("Cookie")) {
    return "cookie";
  }
  if (refName?.startsWith("Json")) {
    return "body";
  }
  return pathParameters.has(name) ? "path" : undefined;
}

function getParameterTypeSchema(
  schema: JsonSchema,
  components: Record<string, JsonSchema>,
): JsonSchema {
  return stripParameterMeta(resolveSchemaRef(schema, components));
}

function readConstProperty(
  schema: JsonSchema | undefined,
  key: string,
  components: Record<string, JsonSchema>,
): unknown {
  if (!schema) {
    return undefined;
  }

  const resolvedSchema = resolveSchemaRef(schema, components);
  const property = resolvedSchema.properties?.[key];
  if (!isJsonSchema(property)) {
    return undefined;
  }

  return resolveSchemaRef(property, components).const;
}

function readParamsMetadata(
  paramsSchema: JsonSchema | undefined,
  components: Record<string, JsonSchema>,
): Record<string, ParamMetadata> {
  if (!paramsSchema) {
    return {};
  }

  const resolved = resolveSchemaRef(paramsSchema, components);
  const properties = resolved?.properties;
  if (!properties || typeof properties !== "object") {
    return {};
  }

  const metadata: Record<string, ParamMetadata> = {};

  for (const [name, entry] of Object.entries(properties)) {
    if (!isJsonSchema(entry)) {
      continue;
    }

    const resolvedEntry = resolveSchemaRef(entry, components);
    const location = readConstProperty(resolvedEntry, "in", components);
    const alias = readConstProperty(resolvedEntry, "alias", components);
    const title = readConstProperty(resolvedEntry, "title", components);
    const description = readConstProperty(
      resolvedEntry,
      "description",
      components,
    );
    const example = readConstProperty(resolvedEntry, "example", components);
    const deprecated = readConstProperty(
      resolvedEntry,
      "deprecated",
      components,
    );

    metadata[name] = {
      ...(typeof location === "string" ? { in: location } : {}),
      ...(typeof alias === "string" ? { alias } : {}),
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof description === "string" ? { description } : {}),
      ...(example !== undefined ? { example } : {}),
      ...(typeof deprecated === "boolean" ? { deprecated } : {}),
    };
  }

  return metadata;
}

function resolveRootSchema(
  application: JsonApplication,
  components: Record<string, JsonSchema>,
): JsonSchema | undefined {
  if (application.schema && isJsonSchema(application.schema)) {
    return resolveSchemaRef(application.schema, components);
  }

  const [firstSchema] = application.schemas ?? [];
  return isJsonSchema(firstSchema)
    ? resolveSchemaRef(firstSchema, components)
    : undefined;
}

function parseParametersSchema(routePath: string, raw: unknown): {
  parameters: JsonSchema[];
  requestBody?: JsonSchema;
} {
  if (
    isJsonSchema(raw) &&
    "__entries" in raw &&
    Array.isArray(raw.__entries)
  ) {
    return {
      parameters: raw.__entries,
      requestBody: raw.__body,
    };
  }

  const fallback = {
    parameters: buildPathParameters(routePath),
  };

  if (!isJsonSchema(raw)) {
    return fallback;
  }

  const hasSchema = "schema" in raw || "schemas" in raw;
  if (!hasSchema || !("components" in raw)) {
    return fallback;
  }

  const application = raw as JsonApplication;
  const components = application.components?.schemas;
  if (!components) {
    return fallback;
  }

  const root = resolveRootSchema(application, components);
  const properties = root?.properties;
  if (!properties || typeof properties !== "object") {
    return fallback;
  }

  const required = new Set(
    Array.isArray(root.required)
      ? root.required.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  );
  const pathParameters = new Set(getPathParameterNames(routePath));
  const metadata = readParamsMetadata(properties.__params, components);
  const parameters: JsonSchema[] = [];
  const bodyProperties: Record<string, JsonSchema> = {};
  const bodyRequired: string[] = [];
  const seenPathParameters = new Set<string>();

  for (const [name, property] of Object.entries(properties)) {
    if (name === "__params" || !isJsonSchema(property)) {
      continue;
    }

    const refName = getSchemaRefName(property);
    const paramMetadata = metadata[name] ?? {};
    const location =
      paramMetadata.in === "path" ||
      paramMetadata.in === "query" ||
      paramMetadata.in === "header" ||
      paramMetadata.in === "cookie" ||
      paramMetadata.in === "body"
        ? paramMetadata.in
        : getParameterLocation(name, refName, pathParameters);
    if (!location) {
      continue;
    }

    const title =
      paramMetadata.title ??
      (typeof property.title === "string" ? property.title : undefined);
    const description =
      paramMetadata.description ??
      (typeof property.description === "string" ? property.description : undefined);
    const deprecated =
      paramMetadata.deprecated ?? (property.deprecated === true ? true : undefined);
    const typeSchema = {
      ...getParameterTypeSchema(property, components),
      ...(title ? { title } : {}),
    };
    const isRequired = required.has(name);

    if (location === "body") {
      bodyProperties[name] = {
        ...typeSchema,
        ...(description ? { description } : {}),
        ...(paramMetadata.example !== undefined
          ? { example: paramMetadata.example }
          : {}),
      };

      if (isRequired) {
        bodyRequired.push(name);
      }
      continue;
    }

    if (location === "path") {
      seenPathParameters.add(name);
    }

    parameters.push({
      name: paramMetadata.alias ?? name,
      in: location,
      required: location === "path" ? true : isRequired,
      schema: typeSchema,
      ...(description ? { description } : {}),
      ...(paramMetadata.example !== undefined
        ? { example: paramMetadata.example }
        : {}),
      ...(deprecated === true ? { deprecated: true as const } : {}),
    });
  }

  for (const name of getPathParameterNames(routePath)) {
    if (seenPathParameters.has(name)) {
      continue;
    }

    parameters.push({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }

  if (Object.keys(bodyProperties).length === 0) {
    return { parameters };
  }

  return {
    parameters,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: bodyProperties,
            ...(bodyRequired.length ? { required: bodyRequired } : {}),
          },
        },
      },
    },
  };
}

function readLiteralParameters(raw: unknown): {
  parameters: JsonSchema[];
  requestBody?: JsonSchema;
} | null {
  if (
    !isJsonSchema(raw) ||
    !("__entries" in raw) ||
    !Array.isArray(raw.__entries)
  ) {
    return null;
  }

  return {
    parameters: raw.__entries,
    requestBody: raw.__body,
  };
}

function readLiteralResponses(raw: unknown): JsonSchema | null {
  if (
    !isJsonSchema(raw) ||
    !("__responses" in raw) ||
    !Array.isArray(raw.__responses)
  ) {
    return null;
  }

  return raw;
}

function mergeParameters(
  middlewareParameters: JsonSchema[],
  routeParameters: JsonSchema[],
): JsonSchema[] {
  const merged = [...middlewareParameters, ...routeParameters];
  const seen = new Set<string>();
  const result: JsonSchema[] = [];

  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const parameter = merged[index]!;
    const key = `${String(parameter.name)}:${String(parameter.in)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.unshift(parameter);
  }

  return result;
}

function resolveSchemaRef(
  schema: JsonSchema,
  components: Record<string, JsonSchema>,
): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref !== "string") {
    return schema;
  }

  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) {
    return schema;
  }

  return components[ref.slice(prefix.length)] ?? schema;
}

function getStatusCode(
  schema: JsonSchema,
  components: Record<string, JsonSchema>,
): number {
  const resolved = resolveSchemaRef(schema, components);
  const status =
    resolved.properties?.__response?.properties?.status?.const ??
    resolved.allOf
      ?.map((item: JsonSchema) => getStatusCode(item, components))
      .find((value: number | undefined) => value !== undefined);
  return typeof status === "number" ? status : 200;
}

function isEmptySchema(schema: JsonSchema): boolean {
  return Object.keys(schema).length === 0;
}

function stripResponseMeta(
  schema: JsonSchema,
  components: Record<string, JsonSchema>,
): JsonSchema {
  const resolved = resolveSchemaRef(schema, components);

  if (Array.isArray(resolved.allOf)) {
    const allOf = resolved.allOf
      .map((item: JsonSchema) => stripResponseMeta(item, components))
      .filter((item: JsonSchema) => !isEmptySchema(item));

    if (allOf.length === 0) {
      return {};
    }

    if (allOf.length === 1) {
      return allOf[0]!;
    }

    return { ...resolved, allOf };
  }

  const next: JsonSchema = { ...resolved };
  if (resolved.properties && typeof resolved.properties === "object") {
    const properties = { ...resolved.properties };
    delete properties.__response;
    next.properties = properties;
  }

  if (Array.isArray(resolved.required)) {
    next.required = resolved.required.filter(
      (entry: string) => entry !== "__response",
    );
    if (next.required.length === 0) {
      delete next.required;
    }
  }

  return next;
}

function buildResponses(responses: unknown): Record<string, JsonSchema> {
  if (
    isJsonSchema(responses) &&
    "__responses" in responses &&
    Array.isArray(responses.__responses)
  ) {
    const result: Record<string, JsonSchema> = {};

    for (const entry of responses.__responses) {
      if (!isJsonSchema(entry)) {
        continue;
      }

      const status = String(
        typeof entry.status === "number" ? entry.status : 200,
      );
      const response: JsonSchema = { description: "" };

      if (isJsonSchema(entry.schema) && Object.keys(entry.schema).length > 0) {
        response.content = {
          "application/json": {
            schema: entry.schema,
          },
        };
      }

      if (isJsonSchema(entry.headers) && Object.keys(entry.headers).length > 0) {
        response.headers = {};
        for (const [name, value] of Object.entries(entry.headers)) {
          if (typeof value !== "string") {
            continue;
          }

          response.headers[name] = {
            schema: { type: "string", const: value },
          };
        }

        if (Object.keys(response.headers).length === 0) {
          delete response.headers;
        }
      }

      result[status] = response;
    }

    return Object.keys(result).length > 0
      ? result
      : { "200": { description: "" } };
  }

  const application = responses as JsonApplication | undefined;
  if (!application?.schemas?.length) {
    return {
      "200": { description: "" },
    };
  }

  const componentSchemas = application.components?.schemas ?? {};
  const result: Record<string, JsonSchema> = {};

  for (const schema of application.schemas) {
    const variants = Array.isArray(schema.oneOf) ? schema.oneOf : [schema];

    for (const variant of variants) {
      const status = String(getStatusCode(variant, componentSchemas));
      result[status] = {
        description: "",
        content: {
          "application/json": {
            schema: stripResponseMeta(variant, componentSchemas),
          },
        },
      };
    }
  }

  return Object.keys(result).length > 0
    ? result
    : {
        "200": { description: "" },
      };
}

export function openapi(config: OpenAPIConfig) {
  const document: Record<string, any> = {
    openapi: "3.1.0",
    info: config.info,
    paths: {},
    components: {
      schemas: {},
    },
  };

  if (config.servers?.length) {
    document.servers = config.servers;
  }

  for (const route of config.routes) {
    if (route.config.expose !== true) {
      continue;
    }

    const path = toOpenAPIPath(route.config.path);
    const method = route.config.method.toLowerCase();
    const metadata = route as unknown as Record<PropertyKey, unknown>;
    const paramDefs = metadata[routeParametersSymbol] as unknown;
    const routeParameters: {
      parameters: JsonSchema[];
      requestBody?: JsonSchema;
    } = paramDefs
      ? parseParametersSchema(route.config.path, paramDefs)
      : {
          parameters: buildPathParameters(route.config.path),
        };
    const middlewareParameters: JsonSchema[] = [];
    const injectParameters: JsonSchema[] = [];
    let middlewareResponses: Record<string, JsonSchema> = {};
    let injectResponses: Record<string, JsonSchema> = {};
    let middlewareRequestBody: JsonSchema | undefined;
    let injectRequestBody: JsonSchema | undefined;

    for (const mw of route.config.middlewares ?? []) {
      const mwMeta = mw as unknown as Record<PropertyKey, unknown>;

      const literalParams = readLiteralParameters(mwMeta[middlewareParametersSymbol]);
      if (literalParams) {
        middlewareParameters.push(...literalParams.parameters);
        middlewareRequestBody ??= literalParams.requestBody;
      }

      const literalResp = readLiteralResponses(mwMeta[middlewareResponsesSymbol]);
      if (literalResp) {
        middlewareResponses = { ...middlewareResponses, ...buildResponses(literalResp) };
      }

      const mwInjectConfig = mwMeta[middlewareInjectSymbol] as
        | Record<string, unknown>
        | undefined;
      if (mwInjectConfig) {
        for (const injectable of Object.values(mwInjectConfig)) {
          const injectMeta = injectable as unknown as Record<PropertyKey, unknown>;

          const injectLiteralParams = readLiteralParameters(
            injectMeta[injectableParametersSymbol],
          );
          if (injectLiteralParams) {
            middlewareParameters.push(...injectLiteralParams.parameters);
            middlewareRequestBody ??= injectLiteralParams.requestBody;
          }

          const injectLiteralResp = readLiteralResponses(
            injectMeta[injectableResponsesSymbol],
          );
          if (injectLiteralResp) {
            middlewareResponses = {
              ...middlewareResponses,
              ...buildResponses(injectLiteralResp),
            };
          }
        }
      }
    }

    for (const injectable of Object.values(route.config.inject ?? {})) {
      const injectMeta = injectable as unknown as Record<PropertyKey, unknown>;

      const literalParams = readLiteralParameters(
        injectMeta[injectableParametersSymbol],
      );
      if (literalParams) {
        injectParameters.push(...literalParams.parameters);
        injectRequestBody ??= literalParams.requestBody;
      }

      const literalResp = readLiteralResponses(
        injectMeta[injectableResponsesSymbol],
      );
      if (literalResp) {
        injectResponses = { ...injectResponses, ...buildResponses(literalResp) };
      }
    }

    const parameters = mergeParameters(
      mergeParameters(middlewareParameters, injectParameters),
      routeParameters.parameters,
    );
    const requestBody =
      routeParameters.requestBody ??
      injectRequestBody ??
      middlewareRequestBody;
    const responses = metadata[
      routeResponsesSymbol
    ];
    const application = responses as JsonApplication | undefined;
    const routeResponses = buildResponses(responses);

    Object.assign(
      document.components.schemas,
      application?.components?.schemas ?? {},
    );

    if (!document.paths[path]) {
      document.paths[path] = {};
    }

    document.paths[path][method] = {
      ...(route.config.tags?.length ? { tags: route.config.tags } : {}),
      ...(route.config.summary ? { summary: route.config.summary } : {}),
      ...(route.config.description
        ? { description: route.config.description }
        : {}),
      ...(route.config.operationId
        ? { operationId: route.config.operationId }
        : {}),
      parameters,
      ...(requestBody ? { requestBody } : {}),
      responses: {
        ...middlewareResponses,
        ...injectResponses,
        ...routeResponses,
      },
      ...(route.config.deprecated === true ? { deprecated: true } : {}),
      ...(route.config.externalDocs
        ? { externalDocs: route.config.externalDocs }
        : {}),
    };
  }

  return document;
}

export type { OpenAPIConfig };
