import type { Injectable } from "./inject.js";
import type { Middleware, Validate } from "./types.js";

export const middlewareParametersSymbol = Symbol("middlewareParameters");
export const middlewareResponsesSymbol = Symbol("middlewareResponses");
export const middlewareInjectSymbol = Symbol("middlewareInject");
export const middlewareValidateSymbol = Symbol("middlewareValidate");

type InternalMiddleware = Middleware & {
  [middlewareParametersSymbol]?: unknown;
  [middlewareResponsesSymbol]?: unknown;
  [middlewareInjectSymbol]?: Record<string, Injectable<any>>;
  [middlewareValidateSymbol]?: Validate<unknown>;
};

export function middleware<THandler extends (...args: any[]) => any>(
  handler: THandler,
  options?: {
    parameters?: unknown;
    responses?: unknown;
    inject?: Record<string, Injectable<any>>;
    validate?: Validate<unknown>;
  },
): Middleware {
  const typedMiddleware = handler as InternalMiddleware;

  if (options?.parameters !== undefined) {
    typedMiddleware[middlewareParametersSymbol] = options.parameters;
  }

  if (options?.responses !== undefined) {
    typedMiddleware[middlewareResponsesSymbol] = options.responses;
  }

  if (options?.inject !== undefined) {
    typedMiddleware[middlewareInjectSymbol] = options.inject;
  }

  if (options?.validate !== undefined) {
    typedMiddleware[middlewareValidateSymbol] = options.validate;
  }

  return typedMiddleware;
}
