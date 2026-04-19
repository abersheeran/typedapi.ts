import {
  createPathMatcher,
  executeRoute,
  extractParams,
  handleError,
  jsonResponse,
  routeOnErrorSymbol,
  routeParametersSymbol,
  routeResponsesSymbol,
  routeValidateSymbol,
} from "./api.js";
import type { Middleware, Route, RouteMatch } from "./types.js";

interface RoutesConfig<TContext = unknown> {
  prefix?: string;
  middlewares?: Middleware<TContext, any>[];
  tags?: string[];
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
}

type InternalRoute<TContext = unknown> = Route<any, any, TContext> & {
  [routeOnErrorSymbol]?: (error: unknown, request: Request) => Response | Promise<Response>;
  [routeParametersSymbol]?: unknown;
  [routeValidateSymbol]?: (input: unknown) => unknown;
  [routeResponsesSymbol]?: unknown;
};

export function routes<TContext = unknown>(
  config: RoutesConfig<TContext>,
  ...items: Array<Route<any, any, TContext>>
): Array<Route<any, any, TContext>> {
  return items.map((route) => {
    const { tags: routeTags, ...routeConfig } = route.config;
    const method = route.config.method.toUpperCase();
    const path = joinPath(config.prefix ?? "", route.config.path);
    const middlewares = [
      ...(config.middlewares ?? []),
      ...(route.config.middlewares ?? []),
    ];
    const tags = [
      ...new Set([...(config.tags ?? []), ...(routeTags ?? [])]),
    ];
    const matchPath = createPathMatcher(path);
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
    const existingOnError = (route as InternalRoute<TContext>)[routeOnErrorSymbol];
    const effectiveOnError = existingOnError ?? config.onError;

    const wrapped: Route<any, any, TContext> = {
      config: {
        ...routeConfig,
        method,
        path,
        middlewares,
        ...(tags.length ? { tags } : {}),
      },
      handler: route.handler,
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

        if (effectiveOnError) {
          try {
            return await executeRoute(wrapped, extracted.data, request, context);
          } catch (error) {
            try {
              return await effectiveOnError(error, request);
            } catch (onErrorError) {
              return handleError(onErrorError);
            }
          }
        }

        return executeRoute(wrapped, extracted.data, request, context);
      },
    };

    const validate = (route as InternalRoute<TContext>)[routeValidateSymbol];
    if (validate) {
      (wrapped as InternalRoute<TContext>)[routeValidateSymbol] = validate;
    }

    const responses = (route as InternalRoute<TContext>)[routeResponsesSymbol];
    if (responses) {
      (wrapped as InternalRoute<TContext>)[routeResponsesSymbol] = responses;
    }

    const parameters = (route as InternalRoute<TContext>)[routeParametersSymbol];
    if (parameters) {
      (wrapped as InternalRoute<TContext>)[routeParametersSymbol] = parameters;
    }

    if (effectiveOnError) {
      (wrapped as InternalRoute<TContext>)[routeOnErrorSymbol] = effectiveOnError;
    }

    return wrapped;
  });
}

function joinPath(prefix: string, path: string): string {
  const segments = [prefix, path].map(trimSlashes).filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
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
