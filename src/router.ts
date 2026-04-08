import { handleError } from "./api.js";
import type { AnyRoute } from "./types.js";

export function createRouter(routes: AnyRoute[]) {
  const index = new Map<
    string,
    { staticMap: Map<string, AnyRoute>; dynamic: AnyRoute[] }
  >();

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

  return async (request: Request): Promise<Response> => {
    const bucket = index.get(request.method);
    if (!bucket) {
      return notFound();
    }

    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);

    try {
      const staticRoute = bucket.staticMap.get(pathname);
      if (staticRoute) {
        return await staticRoute.handle(request, { params: {}, url });
      }

      for (const route of bucket.dynamic) {
        const match = route.match(request, url);
        if (match) {
          return await route.handle(
            request,
            match.url ? match : { ...match, url },
          );
        }
      }
    } catch (error) {
      return handleError(error);
    }

    return notFound();
  };
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
