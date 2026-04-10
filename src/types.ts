import type { Injectable } from "./inject.js";

declare const htmlResponseSymbol: unique symbol;
declare const textResponseSymbol: unique symbol;
declare const streamResponseSymbol: unique symbol;
declare const sseResponseSymbol: unique symbol;

export interface ParamMeta {
  alias?: string;
  title?: string;
  description?: string;
  example?: unknown;
  deprecated?: boolean;
}

export type Path<T, Meta extends ParamMeta = {}> = T & {
  readonly __path?: Meta;
};

export type Query<T, Meta extends ParamMeta = {}> = T & {
  readonly __query?: Meta;
};

export type Header<T, Meta extends ParamMeta = {}> = T & {
  readonly __header?: Meta;
};

export type Cookie<T, Meta extends ParamMeta = {}> = T & {
  readonly __cookie?: Meta;
};

export type Json<T, Meta extends ParamMeta = {}> = T & {
  readonly __body?: Meta;
};

export type Form<T, Meta extends ParamMeta = {}> = T & {
  readonly __form?: Meta;
};

// Exclude runtime injectables from request validation input.
export type RequestParams<T> = {
  [K in keyof T as T[K] extends { readonly __inject?: true } ? never : K]: T[K];
};

type ExtractParamInfo<T> =
  T extends { readonly __path?: infer M extends ParamMeta }
    ? { readonly in: "path" } & { readonly [K in keyof M]: M[K] }
    : T extends { readonly __query?: infer M extends ParamMeta }
      ? { readonly in: "query" } & { readonly [K in keyof M]: M[K] }
      : T extends { readonly __header?: infer M extends ParamMeta }
        ? { readonly in: "header" } & { readonly [K in keyof M]: M[K] }
        : T extends { readonly __cookie?: infer M extends ParamMeta }
          ? { readonly in: "cookie" } & { readonly [K in keyof M]: M[K] }
          : T extends { readonly __body?: infer M extends ParamMeta }
            ? { readonly in: "body" } & { readonly [K in keyof M]: M[K] }
            : T extends { readonly __form?: infer M extends ParamMeta }
              ? { readonly in: "form" } & { readonly [K in keyof M]: M[K] }
            : never;

export type ParamsSchema<T> = T & {
  readonly __params?: {
    readonly [K in keyof T as ExtractParamInfo<T[K]> extends never
      ? never
      : K]: ExtractParamInfo<T[K]>;
  };
};

export type JsonResponse<
  Status extends number = 200,
  Headers extends Record<string, string | string[]> = {},
  Body = unknown,
> = [Body] extends [null | undefined | void]
  ? Body | {
      readonly __response?: {
        readonly status: Status;
        readonly headers: Headers;
        readonly body: Body;
      };
    }
  : Body & {
      readonly __response?: {
        readonly status: Status;
        readonly headers: Headers;
        readonly body: Body;
      };
    };

export type HtmlResponse<
  Status extends number = 200,
  Headers extends Record<string, string | string[]> = {},
> = string & {
  readonly [htmlResponseSymbol]?: {
    status: Status;
    headers: Headers;
  };
};

export type TextResponse<
  Status extends number = 200,
  Headers extends Record<string, string | string[]> = {},
> = string & {
  readonly [textResponseSymbol]?: {
    status: Status;
    headers: Headers;
  };
};

export type StreamResponse<
  Status extends number = 200,
  Headers extends Record<string, string | string[]> = {},
> = ReadableStream & {
  readonly [streamResponseSymbol]?: {
    status: Status;
    headers: Headers;
  };
};

export type SseResponse<
  Status extends number = 200,
  Headers extends Record<string, string | string[]> = {},
> = ReadableStream & {
  readonly [sseResponseSymbol]?: {
    status: Status;
    headers: Headers;
  };
};

export type Middleware = (
  next: () => Promise<Response>,
) => (params: Record<string, unknown>) => Response | Promise<Response>;

export type RouterMiddleware = (
  request: Request,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export interface RouteConfig {
  method: string;
  path: string;
  expose?: boolean;
  middlewares?: Middleware[];
  inject?: Record<string, Injectable<any>>;
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  externalDocs?: {
    url: string;
    description?: string;
  };
}

export interface RouteMatch {
  params: Record<string, unknown>;
  url?: URL;
}

export type Validate<T> = (
  input: unknown,
) =>
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      errors: unknown[];
    };

export type RouteHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
) => TResult | Promise<TResult>;

export interface Route<TParams = unknown, TResult = unknown> {
  config: RouteConfig;
  handler: RouteHandler<TParams, TResult>;
  match(request: Request, url?: URL): RouteMatch | null;
  matchPath(url: URL): RouteMatch | null;
  handle(request: Request, match?: RouteMatch): Promise<Response>;
}

export type AnyRoute = Route<any, any>;
