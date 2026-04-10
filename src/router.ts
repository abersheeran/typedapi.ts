import { handleError } from "./api.js";
import type { AnyRoute, RouterMiddleware } from "./types.js";

interface RouteBucket {
  staticMap: Map<string, AnyRoute>;
  dynamic: AnyRoute[];
}

export function createRouter(
  routes: AnyRoute[],
  options?: { middlewares?: RouterMiddleware[] },
) {
  const index = new Map<string, RouteBucket>();

  for (const route of routes) {
    const method = route.config.method.toUpperCase();
    let bucket = index.get(method);
    if (!bucket) {
      bucket = { staticMap: new Map(), dynamic: [] };
      index.set(method, bucket);
    }

    const path = route.config.path;
    if (isStaticPath(path)) {
      const normalized = normalizePath(path);
      if (!bucket.staticMap.has(normalized)) {
        bucket.staticMap.set(normalized, route);
      }
      continue;
    }

    bucket.dynamic.push(route);
  }

  const coreHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);

    if (request.method === "OPTIONS") {
      const optionsBucket = index.get("OPTIONS");
      if (optionsBucket) {
        const response = await dispatchBucket(
          optionsBucket,
          request,
          pathname,
          url,
        );
        if (response) {
          return response;
        }
      }

      const allow = collectAllowedMethods(index, pathname, url);
      if (allow.length === 0) {
        return notFound();
      }

      return noContent(allow);
    }

    const bucket = index.get(request.method);
    if (!bucket) {
      return notFound();
    }

    const response = await dispatchBucket(bucket, request, pathname, url);
    if (response) {
      return response;
    }

    return notFound();
  };

  let handler = coreHandler;
  const middlewares = options?.middlewares ?? [];

  for (let index = middlewares.length - 1; index >= 0; index -= 1) {
    const middleware = middlewares[index];
    if (!middleware) {
      continue;
    }

    const next = handler;
    handler = (request) =>
      Promise.resolve().then(() => middleware(request, () => next(request)));
  }

  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      return handleError(error);
    }
  };
}

export function composeHandlers(
  ...handlers: Array<(request: Request) => Promise<Response>>
): (request: Request) => Promise<Response> {
  return async (request) => {
    for (const handler of handlers) {
      const response = await handler(request);
      if (response.status !== 404) {
        return response;
      }
    }

    return notFound();
  };
}

async function dispatchBucket(
  bucket: RouteBucket,
  request: Request,
  pathname: string,
  url: URL,
): Promise<Response | null> {
  const staticRoute = bucket.staticMap.get(pathname);
  if (staticRoute) {
    return staticRoute.handle(request, { params: {}, url });
  }

  for (const route of bucket.dynamic) {
    const match = route.match(request, url);
    if (match) {
      return route.handle(
        request,
        match.url ? match : { ...match, url },
      );
    }
  }

  return null;
}

function collectAllowedMethods(
  index: Map<string, RouteBucket>,
  pathname: string,
  url: URL,
): string[] {
  const allow = new Set<string>();

  for (const [method, bucket] of index) {
    if (bucket.staticMap.has(pathname)) {
      allow.add(method);
      continue;
    }

    if (bucket.dynamic.some((route) => route.matchPath(url))) {
      allow.add(method);
    }
  }

  if (allow.size === 0) {
    return [];
  }

  allow.add("OPTIONS");
  return [...allow];
}

function isStaticPath(path: string): boolean {
  return !path.includes(":");
}

function normalizePath(path: string): string {
  const trimmed = trimSlashes(path);
  return trimmed ? `/${trimmed}` : "/";
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

function notFound(): Response {
  return new Response(JSON.stringify({ message: "Not Found" }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function noContent(allow: string[]): Response {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: allow.join(", "),
    },
  });
}
