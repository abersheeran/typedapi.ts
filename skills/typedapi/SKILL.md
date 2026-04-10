---
name: typedapi
description: Help AI agents understand and use the typedapi.ts framework for building type-safe HTTP APIs. Use this when creating or modifying typedapi.ts routes, middleware, dependency injection, CORS, response helpers, or OpenAPI generation.
license: MIT
---

# typedapi

Use this skill when working in a project that uses `typedapi.ts`.

The framework is a type-safe HTTP API layer built on the standard `Request` / `Response` / `fetch` interfaces. The main pattern is:

1. Define endpoints with `api()`.
2. Compose them with `routes()` and `createRouter()`.
3. Model request data with wrapper types such as `Path<T>` and `Json<T>`.
4. Return plain values or response helpers and let the framework convert them to `Response`.
5. Enable the TypeScript transformer when you want compile-time OpenAPI metadata extraction.

## Install And Setup

Install the framework:

```bash
npm install typedapi.ts
```

`typia` and `ts-patch` are required peer dependencies and are installed automatically alongside `typedapi.ts` (npm 7+). Use `tspc` (provided by `ts-patch`) instead of `tsc` in your build scripts. `tspc` is a drop-in `tsc` replacement that applies custom transformers without patching your TypeScript installation.

Use this `tsconfig.json` plugin order when you want compile-time metadata extraction and Typia validation:

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "typedapi.ts/transform" },
      { "transform": "typia/lib/transform" }
    ]
  }
}
```

Rules:

- `typedapi.ts/transform` must come before `typia/lib/transform`.
- Use `tspc -p tsconfig.json` (from `ts-patch`) instead of `tsc` in build scripts. `tspc` is a drop-in replacement with no global side effects.
- `typia` and `ts-patch` are required peer dependencies.

## Quick Start

```ts
import { api, createRouter } from "typedapi.ts";

const health = api({ method: "GET", path: "/health" }, async () => {
  return { status: "ok" };
});

export default createRouter([health]);
```

`createRouter<T>()` returns a `(request: Request, context?: T) => Promise<Response>` handler, so it fits Workers-style and Fetch-based runtimes directly. Handlers, middleware, and inject functions receive `{ request, context }` as a second argument. Use the second argument of `createRouter` for router-wide behavior such as `{ middlewares, onError }`.

## Core Rules

### Request parameters

Model handler params with wrapper types instead of manually parsing the request:

- `Path<T, Meta>`
- `Query<T, Meta>`
- `Header<T, Meta>`
- `Cookie<T, Meta>`
- `Json<T, Meta>`
- `Form<T, Meta>`

Parameter merge precedence is:

`path > body > query > cookie > header`

Access the raw `Request` and custom context via the handler's second argument `{ request, context }`.

```ts
import { api, Path, Query, Json } from "typedapi.ts";

const updateUser = api(
  { method: "PUT", path: "/users/:id" },
  async (params: {
    id: Path<number>;
    notify?: Query<boolean>;
    name: Json<string>;
  }) => {
    return {
      id: params.id,
      notify: params.notify,
      name: params.name,
    };
  },
);
```

### Validation

Write runtime validators explicitly in the `api()` call. The transformer does not generate `validate`.

```ts
import typia from "typia";
import {
  api,
  inject,
  type Inject,
  type Json,
  type Path,
  type RequestParams,
} from "typedapi.ts";

const db = inject(async () => connectDb());

type CreateUserParams = {
  id: Path<number>;
  body: Json<{ name: string }>;
  db: Inject<typeof db>;
};

const createUser = api(
  { method: "POST", path: "/users/:id" },
  async (params: CreateUserParams) => {
    return { id: params.id, name: params.body.name };
  },
  {
    validate: typia.createValidate<RequestParams<CreateUserParams>>(),
  },
);
```

Rules:

- Import `typia` in every file that passes `validate` to `api()`.
- Use `RequestParams<T>` whenever handler params include `Inject<typeof dependency>`.
- `api()` validation runs on request-sourced params only.

### Response handling

Prefer returning plain values unless you need explicit status, headers, or content type. `typedapi.ts` auto-converts handler results as follows:

- `Response` -> passthrough
- `null` -> `204 No Content`
- `string` -> `text/plain; charset=utf-8`
- `URL` -> `307` redirect
- `ReadableStream` -> `application/octet-stream`
- `AsyncIterable` -> `text/event-stream`
- anything else -> JSON

Available response helpers:

- `json()`
- `html()`
- `text()`
- `stream()`
- `sse()`
- `redirect()`
- `file()`
- `cookie()` / `clearCookie()` for `Set-Cookie` values

```ts
import { api, json, text, redirect } from "typedapi.ts";

const createUser = api(
  { method: "POST", path: "/users" },
  async () => json({ id: 1 }, 201, { location: "/users/1" }),
);

const health = api({ method: "GET", path: "/health" }, async () => text("ok"));

const docs = api(
  { method: "GET", path: "/docs" },
  async () => redirect("https://example.com/docs"),
);
```

### Middleware and route groups

Middleware uses the onion model. The signature is:

```ts
(next) => (params) => Response | Promise<Response>
```

Use `middleware()` when you want typed reusable middleware that can also contribute OpenAPI metadata.

Use `createRouter(..., { middlewares, onError })` for router-wide behavior, and `routes()` to add a common prefix, middleware stack, group-level `tags`, or group-level `onError` handler. Group middleware runs before route-level middleware. Nested `routes()` calls stack prefixes and middleware, and merge group tags ahead of route tags with deduplication.

```ts
import { api, createRouter, Header, middleware, routes } from "typedapi.ts";

const auth = middleware((next) =>
  async (params: { authorization: Header<string> }) => {
    if (!params.authorization?.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return next();
  },
);

const getUsers = api({ method: "GET", path: "/users" }, async () => [{ id: 1 }]);

export default createRouter(
  routes({ prefix: "/api", middlewares: [auth] }, getUsers),
);
```

### CORS

Use `cors()` as router middleware via `createRouter(..., { middlewares: [cors()] })`. It handles normal responses and preflight requests while letting `createRouter()` keep control of route matching and automatic `OPTIONS` responses.

```ts
import { api, cors, createRouter } from "typedapi.ts";

const health = api(
  { method: "GET", path: "/health" },
  async () => ({ status: "ok" }),
);

export default createRouter([health], {
  middlewares: [cors()],
});
```

### Error handling

Throw `HttpError(status, body?, headers?)` for controlled HTTP failures.

- string `body` becomes `{ message }`
- object `body` is returned as JSON
- omitted `body` returns an empty response body

Unhandled non-`HttpError` exceptions are rethrown to the caller; the framework does not convert them into `500`.

Use `createRouter(..., { onError })` for app-wide fallback handling and `routes({ onError })` for group-specific strategies. Both receive `(error, request)`. Use `handleError()` when you want the built-in `HttpError` fallback while letting unknown errors bubble up. If an `onError` callback throws, that thrown value is also passed through `handleError()`.

### Dependency injection

Use `inject()` for request-scoped dependencies.

Patterns:

- `async function* () { yield resource; cleanup(); }` for resources with cleanup
- `async () => resource` for simple async values

Inject into handlers with `Inject<typeof dependency>`.

```ts
import { api, inject, type Inject, type Path } from "typedapi.ts";

const db = inject(async function* () {
  const client = await connectDb();
  yield client;
  await client.close();
});

const getUser = api(
  { method: "GET", path: "/users/:id" },
  async (params: {
    id: Path<number>;
    db: Inject<typeof db>;
  }) => {
    return params.db.query("SELECT * FROM users WHERE id = $1", [params.id]);
  },
);
```

Access custom context via the second argument:

```ts
import { inject, type HandlerContext } from "typedapi.ts";

const db = inject(async (_params, { context }: HandlerContext<Env>) => {
  return context.DB;
});
```

Notes:

- `cache: true` is the default, so the same injectable instance is reused within one request.
- If the route also uses `validate`, use `RequestParams<T>` so injected fields are excluded from the validator type.
- Runtime order is `validate -> inject -> handler`; failed validation returns `400` before injectables are resolved.
- cleanup runs in reverse order after the request, even if the handler throws.
- `inject()` handlers can also use `Path`, `Query`, `Header`, `Cookie`, `Json`, and `JsonResponse` so they can contribute request and response metadata.

### OpenAPI and compile-time metadata

Use `openapi()` to generate an OpenAPI 3.1 document from exposed routes:

```ts
import { api, openapi, type Json, type JsonResponse } from "typedapi.ts";

const createOrder = api(
  { method: "POST", path: "/orders", expose: true },
  async (_params: { customer: Json<string> }): Promise<
    JsonResponse<201, {}, { id: number; customer: string }>
  > => {
    return { id: 1, customer: "Acme Corp" };
  },
);

const document = openapi({
  info: { title: "Orders API", version: "1.0.0" },
  routes: [createOrder],
});
```

Rules:

- only routes with `expose: true` are included
- route config also accepts operation metadata: `tags`, `summary`, `description`, `operationId`, `deprecated`, and `externalDocs`
- `routes({ tags })` prepends shared tags to child routes and removes duplicates
- the transformer extracts parameter metadata from wrapper types
- the transformer extracts response metadata from `JsonResponse`
- middleware and inject metadata are merged into route docs
- merge precedence is `middleware < inject < route`
- if `parameters` or `responses` are already supplied manually, the transformer does not overwrite them

## Working Style

When modifying a typedapi codebase:

1. Prefer wrapper-typed params over manual `URL`, `headers`, or body parsing.
2. Prefer plain object returns unless status, headers, streaming, SSE, redirects, or files require helper functions.
3. Use `routes()` for shared prefix, middleware, or group-level error handling instead of duplicating config across endpoints.
4. Add `expose: true` only for routes that belong in the OpenAPI document.
5. Check transformer setup before assuming OpenAPI metadata will appear automatically.

## Reference

Read [references/api-reference.md](references/api-reference.md) when you need exact examples for:

- CRUD routes and parameter wrappers
- response helpers and auto-conversion
- cookies, files, streams, and SSE
- middleware, grouping, CORS, and errors
- dependency injection and typed injectables
- OpenAPI generation and Typia runtime validation
