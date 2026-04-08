import {
  createPathMatcher,
  executeRoute,
  extractParams,
  jsonResponse,
  routeResponsesSymbol,
  routeValidateSymbol,
} from "./api.js";
import type { AnyRoute, Middleware, RouteMatch } from "./types.js";

interface RoutesConfig {
  prefix?: string;
  middlewares?: Middleware[];
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
}

type InternalRoute = AnyRoute & {
  [routeValidateSymbol]?: (input: unknown) => unknown;
  [routeResponsesSymbol]?: unknown;
};

export function routes(config: RoutesConfig, ...items: AnyRoute[]): AnyRoute[] {
  const onError = config.onError;

  return items.map((route) => {
    const method = route.config.method.toUpperCase();
    const path = joinPath(config.prefix ?? "", route.config.path);
    const middlewares = [
      ...(config.middlewares ?? []),
      ...(route.config.middlewares ?? []),
    ];
    const matchPath = createPathMatcher(path);
    const matchRequest = (request: Request, url?: URL): RouteMatch | null => {
      if (request.method !== method) {
        return null;
      }

      const parsed = url ?? new URL(request.url);
      const match = matchPath(parsed.pathname);
      if (!match) {
        return null;
      }

      return { params: match.params, url: parsed };
    };

    const wrapped: AnyRoute = {
      config: { ...route.config, method, path, middlewares },
      handler: route.handler,
      match(request, url) {
        return matchRequest(request, url);
      },
      async handle(request, matched) {
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

        if (onError) {
          try {
            return await executeRoute(wrapped, extracted.data);
          } catch (error) {
            return onError(error, request);
          }
        }

        return executeRoute(wrapped, extracted.data);
      },
    };

    const validate = (route as InternalRoute)[routeValidateSymbol];
    if (validate) {
      (wrapped as InternalRoute)[routeValidateSymbol] = validate;
    }

    const responses = (route as InternalRoute)[routeResponsesSymbol];
    if (responses) {
      (wrapped as InternalRoute)[routeResponsesSymbol] = responses;
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
