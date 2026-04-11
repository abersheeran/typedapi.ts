import { HttpError } from "./error.js";
import { resolveInjectables } from "./inject.js";
import {
  middlewareInjectSymbol,
  middlewareValidateSymbol,
} from "./middleware.js";
import type { HandlerContext } from "./context.js";
import type { Injectable } from "./inject.js";
import type {
  Middleware,
  RequestParams,
  Route,
  RouteConfig,
  RouteHandler,
  RouteMatch,
  Validate,
} from "./types.js";
import { redirect, sse, stream, text } from "./response.js";

type HandlerParams<THandler> = THandler extends RouteHandler<infer TParams, unknown>
  ? TParams
  : never;

type HandlerResult<THandler> = THandler extends RouteHandler<unknown, infer TResult>
  ? TResult
  : never;

export const routeValidateSymbol = Symbol("routeValidate");
export const routeResponsesSymbol = Symbol("routeResponses");
export const routeParametersSymbol = Symbol("routeParameters");
export const routeOnErrorSymbol = Symbol("routeOnError");

type ExtractedParams =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string };

type InternalRoute = Route<any, any> & {
  [routeParametersSymbol]?: unknown;
  [routeValidateSymbol]?: Validate<unknown>;
  [routeResponsesSymbol]?: unknown;
  [routeOnErrorSymbol]?: (error: unknown, request: Request) => Response | Promise<Response>;
};

export function api<THandler extends (...args: any[]) => any>(
  config: RouteConfig,
  handler: THandler,
  optionsOrValidate?:
    | Validate<RequestParams<HandlerParams<THandler>>>
    | {
        parameters?: unknown;
        validate?: Validate<RequestParams<HandlerParams<THandler>>>;
        responses?: unknown;
        inject?: Record<string, Injectable<any>>;
      },
): Route<HandlerParams<THandler>, HandlerResult<THandler>> {
  const options =
    typeof optionsOrValidate === "function"
      ? { validate: optionsOrValidate }
      : optionsOrValidate ?? {};
  const validate = options.validate;
  const inject = "inject" in options ? options.inject : undefined;
  const method = config.method.toUpperCase();
  const matchPath = createPathMatcher(config.path);
  const matchUrlPath = (url: URL): RouteMatch | null => {
    const match = matchPath(url.pathname);
    if (!match) {
      return null;
    }

    return { params: match.params, url };
  };
  const matchRequest = (request: Request, url?: URL): RouteMatch | null => {
    if (request.method !== method) {
      return null;
    }

    const parsed = url ?? new URL(request.url);
    return matchUrlPath(parsed);
  };

  const route: Route<HandlerParams<THandler>, HandlerResult<THandler>> = {
    config: { ...config, method, ...(inject ? { inject } : {}) },
    handler: handler as RouteHandler<HandlerParams<THandler>, HandlerResult<THandler>>,
    match(request, url) {
      return matchRequest(request, url);
    },
    matchPath(url) {
      return matchUrlPath(url);
    },
    async handle(request, matched, context) {
      const routeMatch = matched ?? matchRequest(request);
      if (!routeMatch) {
        return jsonResponse({ message: "Not Found" }, 404);
      }

      const extracted = await extractParams(
        request,
        routeMatch.params,
        routeMatch.url,
      );
      if (!extracted.ok) {
        return jsonResponse({ message: extracted.message }, 400);
      }

      return executeRoute(route, extracted.data, request, context);
    },
  };

  if (validate) {
    (route as InternalRoute)[routeValidateSymbol] = validate as Validate<unknown>;
  }

  if (options.parameters) {
    (route as InternalRoute)[routeParametersSymbol] = options.parameters;
  }

  if (options.responses) {
    (route as InternalRoute)[routeResponsesSymbol] = options.responses;
  }

  return route;
}

export function createPathMatcher(path: string) {
  const segments = trimSlashes(path).split("/").filter(Boolean);

  return (pathname: string): RouteMatch | null => {
    const values = trimSlashes(pathname).split("/").filter(Boolean);
    if (segments.length !== values.length) {
      return null;
    }

    const params: Record<string, unknown> = {};

    for (const [index, segment] of segments.entries()) {
      const value = values[index];
      if (value === undefined) {
        return null;
      }

      const decodedValue = decodeSegment(value);
      if (decodedValue === null) {
        return null;
      }

      if (segment.startsWith(":")) {
        params[segment.slice(1)] = parseScalar(decodedValue);
        continue;
      }

      if (segment !== decodedValue) {
        return null;
      }
    }

    return { params };
  };
}

export async function extractParams(
  request: Request,
  pathParams: Record<string, unknown>,
  url?: URL,
): Promise<ExtractedParams> {
  const parsed = url ?? new URL(request.url);
  const headers = readHeaders(request.headers);
  const cookies = readCookies(request.headers.get("cookie"));
  const query = readQuery(parsed.searchParams);
  const body = await readBody(request);

  if (!body.ok) {
    return body;
  }

  return {
    ok: true,
    data: {
      ...headers,
      ...cookies,
      ...query,
      ...body.data,
      ...pathParams,
    },
  };
}

function readHeaders(headers: Headers): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  headers.forEach((value, key) => {
    values[key.toLowerCase()] = value;
  });

  return values;
}

function readCookies(cookieHeader: string | null): Record<string, unknown> {
  if (!cookieHeader) {
    return {};
  }

  const cookies: Record<string, unknown> = {};

  for (const segment of cookieHeader.split(";")) {
    const entry = segment.trim();
    if (!entry) {
      continue;
    }

    const separator = entry.indexOf("=");
    const name = separator === -1 ? entry : entry.slice(0, separator);
    const rawValue = separator === -1 ? "" : entry.slice(separator + 1);
    if (!name) {
      continue;
    }

    cookies[name] = rawValue;
  }

  return cookies;
}

function readQuery(searchParams: URLSearchParams): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  searchParams.forEach((value, key) => {
    const parsed = parseScalar(value);
    const current = query[key];
    if (current === undefined) {
      query[key] = parsed;
    } else if (Array.isArray(current)) {
      current.push(parsed);
    } else {
      query[key] = [current, parsed];
    }
  });

  return query;
}

async function readBody(request: Request): Promise<ExtractedParams> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const text = await request.text();
    if (!text.trim()) {
      return { ok: true, data: {} };
    }

    try {
      const body = JSON.parse(text);
      if (!isRecord(body)) {
        return { ok: false, message: "JSON body must be an object" };
      }
      return { ok: true, data: body };
    } catch {
      return { ok: false, message: "Invalid JSON body" };
    }
  }

  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    return { ok: true, data: {} };
  }

  try {
    const formData = await request.formData();
    const body: Record<string, unknown> = {};

    formData.forEach((value, key) => {
      const parsed = typeof value === "string" ? parseScalar(value) : value;
      const current = body[key];
      if (current === undefined) {
        body[key] = parsed;
      } else if (Array.isArray(current)) {
        current.push(parsed);
      } else {
        body[key] = [current, parsed];
      }
    });

    return { ok: true, data: body };
  } catch {
    return { ok: false, message: "Invalid form body" };
  }
}

function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && value[start] === "/") {
    start++;
  }

  while (end > start && value[end - 1] === "/") {
    end--;
  }

  return value.slice(start, end);
}

function parseScalar(value: string): unknown {
  try {
    const parsed = JSON.parse(value);
    return isJsonScalar(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isJsonScalar(input: unknown): input is string | number | boolean | null {
  return (
    input === null ||
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  );
}

export async function executeRoute(
  route: Route<any, any>,
  params: Record<string, unknown>,
  request: Request,
  context: unknown,
): Promise<Response> {
  let cleanup: (() => Promise<void>) | undefined;
  const ctx: HandlerContext = { request, context };
  const middlewares = route.config.middlewares ?? [];
  const validate = (route as InternalRoute)[routeValidateSymbol];
  const injectConfig = route.config.inject;
  const handler = route.handler as RouteHandler<Record<string, unknown>, unknown>;

  try {
    const innerHandler = async (currentParams: Record<string, unknown>) => {
      if (validate) {
        const result = validate(currentParams);
        if (!result.success) {
          return jsonResponse(
            { message: "Invalid request", errors: result.errors },
            400,
          );
        }
        currentParams = result.data as Record<string, unknown>;
      }

      if (injectConfig && Object.keys(injectConfig).length > 0) {
        const resolved = await resolveInjectables(injectConfig, currentParams, ctx);
        Object.assign(currentParams, resolved.values);
        cleanup = resolved.cleanup;
      }

      const result = await handler(currentParams, ctx);
      return toResponse(result);
    };

    return await runMiddlewares(middlewares, params, ctx, innerHandler);
  } finally {
    if (cleanup) await cleanup();
  }
}

function runMiddlewares(
  middlewares: Middleware[],
  params: Record<string, unknown>,
  ctx: HandlerContext,
  innerHandler: (params: Record<string, unknown>) => Promise<Response>,
): Promise<Response> {
  let chain = innerHandler;

  for (let index = middlewares.length - 1; index >= 0; index -= 1) {
    const middleware = middlewares[index];
    if (!middleware) {
      continue;
    }

    const next = chain;
    const validate = (middleware as Middleware & {
      [middlewareValidateSymbol]?: Validate<unknown>;
    })[middlewareValidateSymbol];
    const injectConfig = (middleware as Middleware & {
      [middlewareInjectSymbol]?: Record<string, Injectable<any>>;
    })[middlewareInjectSymbol];

    if (!validate && !injectConfig) {
      chain = (currentParams) =>
        Promise.resolve(middleware(() => next(currentParams))(currentParams, ctx));
      continue;
    }

    chain = async (currentParams) => {
      if (validate) {
        const result = validate(currentParams);
        if (!result.success) {
          return jsonResponse(
            { message: "Invalid request", errors: result.errors },
            400,
          );
        }
        currentParams = result.data as Record<string, unknown>;
      }

      let cleanup: (() => Promise<void>) | undefined;

      if (injectConfig && Object.keys(injectConfig).length > 0) {
        const resolved = await resolveInjectables(injectConfig, currentParams, ctx);
        Object.assign(currentParams, resolved.values);
        cleanup = resolved.cleanup;
      }

      try {
        return await middleware(() => next(currentParams))(currentParams, ctx);
      } finally {
        if (cleanup) await cleanup();
      }
    };
  }

  return chain(params);
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === null) return new Response(null, { status: 204 });
  if (typeof result === "string") return text(result);
  if (result instanceof ReadableStream) return stream(result);
  if (isAsyncIterable(result)) return sse(result);
  if (result instanceof URL) return redirect(result);
  return jsonResponse(result);
}

function isAsyncIterable(input: unknown): input is AsyncIterable<unknown> {
  return typeof input === "object" && input !== null && Symbol.asyncIterator in input;
}

export function errorResponse(error: HttpError): Response {
  const { status, headers } = error;
  if (error.body === undefined) {
    return new Response(null, headers ? { status, headers } : { status });
  }
  const body = typeof error.body === "string" ? { message: error.body } : error.body;
  return jsonResponse(body, status, headers);
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(body === undefined ? "null" : JSON.stringify(body), {
    status,
    headers: {
      ...(headers ?? {}),
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function handleError(error: unknown): Response {
  if (error instanceof HttpError) {
    return errorResponse(error);
  }
  throw error;
}
