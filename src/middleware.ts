import type { HandlerContext } from "./context.js";
import type { InjectDeps, Injectable } from "./inject.js";
import type { Middleware, Validate } from "./types.js";

export const middlewareParametersSymbol = Symbol("middlewareParameters");
export const middlewareResponsesSymbol = Symbol("middlewareResponses");
export const middlewareInjectSymbol = Symbol("middlewareInject");
export const middlewareValidateSymbol = Symbol("middlewareValidate");

type MiddlewareParams = Record<string, unknown>;

type MiddlewareOptions<I extends Record<string, Injectable<any>> | undefined = undefined> = {
  parameters?: unknown;
  responses?: unknown;
  inject?: I;
  validate?: Validate<unknown>;
};

type MiddlewareInjectedParams<
  TParams extends MiddlewareParams,
  I extends Record<string, Injectable<any>> | undefined,
> = TParams & (I extends Record<string, Injectable<any>> ? InjectDeps<I> : {});

type InternalMiddleware<
  TContext = unknown,
  TParams extends MiddlewareParams = MiddlewareParams,
> = Middleware<TContext, TParams> & {
  [middlewareParametersSymbol]?: unknown;
  [middlewareResponsesSymbol]?: unknown;
  [middlewareInjectSymbol]?: Record<string, Injectable<any>>;
  [middlewareValidateSymbol]?: Validate<unknown>;
};

export function middleware<
  I extends Record<string, Injectable<any>>,
  TParams extends MiddlewareParams = MiddlewareParams,
  TContext = unknown,
>(
  handler: (
    next: () => Promise<Response>,
  ) => (
    params: InjectDeps<I> & TParams,
    ctx: HandlerContext<TContext>,
  ) => Response | Promise<Response>,
  options: Omit<MiddlewareOptions<I>, "inject"> & { inject: I },
): Middleware<TContext, InjectDeps<I> & TParams>;
export function middleware<
  TParams extends MiddlewareParams = MiddlewareParams,
  TContext = unknown,
  I extends Record<string, Injectable<any>> | undefined = undefined,
>(
  handler: (
    next: () => Promise<Response>,
  ) => (
    params: TParams,
    ctx: HandlerContext<TContext>,
  ) => Response | Promise<Response>,
  options?: MiddlewareOptions<I>,
): Middleware<TContext, MiddlewareInjectedParams<TParams, I>>;
export function middleware(
  handler: (...args: any[]) => any,
  options?: MiddlewareOptions<Record<string, Injectable<any>>>,
): Middleware<any, any> {
  const typedMiddleware = handler as InternalMiddleware<any, any>;

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
