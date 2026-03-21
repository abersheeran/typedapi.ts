import type { Middleware } from "./types.js";

export const middlewareParametersSymbol = Symbol("middlewareParameters");
export const middlewareResponsesSymbol = Symbol("middlewareResponses");

type InternalMiddleware = Middleware & {
  [middlewareParametersSymbol]?: unknown;
  [middlewareResponsesSymbol]?: unknown;
};

export function middleware<THandler extends (...args: any[]) => any>(
  handler: THandler,
  options?: { parameters?: unknown; responses?: unknown },
): Middleware {
  const typedMiddleware = handler as Middleware;

  if (options?.parameters !== undefined) {
    (typedMiddleware as InternalMiddleware)[middlewareParametersSymbol] =
      options.parameters;
  }

  if (options?.responses !== undefined) {
    (typedMiddleware as InternalMiddleware)[middlewareResponsesSymbol] =
      options.responses;
  }

  return typedMiddleware;
}
