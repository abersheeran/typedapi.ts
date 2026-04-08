# typedapi.ts API Reference

Load this file when you need concrete typedapi.ts examples or exact public API patterns.

## Contents

- Installation and transformer setup
- Public exports
- Basic router and CRUD routes
- Parameter wrappers
- Request context
- Response auto-conversion
- Response helpers
- Cookie helpers
- Middleware and route groups
- CORS
- Error handling
- Dependency injection
- Typed injectable metadata
- Compile-time metadata extraction
- OpenAPI 3.1 generation
- Runtime validation with Typia

## Public Exports

Functions:

- `api`
- `createRouter`
- `middleware`
- `cors`
- `routes`
- `inject`
- `openapi`
- `json`
- `html`
- `text`
- `stream`
- `sse`
- `redirect`
- `file`
- `cookie`
- `clearCookie`
- `handleError`

Common request and response types:

- `Path<T, Meta>`
- `Query<T, Meta>`
- `Header<T, Meta>`
- `Cookie<T, Meta>`
- `Json<T, Meta>`
- `Form<T, Meta>`
- `Inject<typeof X>`
- `JsonResponse<Status, Headers, Body>`
- `HtmlResponse`
- `TextResponse`
- `StreamResponse`
- `SseResponse`

Framework and utility types:

- `Middleware`
- `HttpError`
- `RequestContext`
- `requestSymbol`
- `Validate<T>`
- `RequestParams<T>`
- `Route`
- `RouteConfig`
- `RouteMatch`

## Installation And Transformer Setup

Install the framework:

```bash
npm install typedapi.ts
```

`typia` and `ts-patch` are required peer dependencies and are installed automatically alongside `typedapi.ts` (npm 7+). Use `tspc` (from `ts-patch`) instead of `tsc` in your build scripts. `tspc` is a drop-in replacement that applies custom transformers without patching your TypeScript installation.

Use `tspc -p tsconfig.json` in your `package.json` scripts:

```json
{
  "scripts": {
    "build": "tspc -p tsconfig.json"
  }
}
```

Configure `tsconfig.json` with the typedapi transformer before Typia:

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

The transformer extracts OpenAPI parameter and response metadata from handler types at compile time.

`typia` and `ts-patch` are required peer dependencies. The transformer injects `parameters`, `responses`, and `inject` metadata, but it does not generate `validate`.

## Basic Router And CRUD Routes

`createRouter()` returns a standard fetch-style request handler.

```ts
import { api, createRouter, Json, JsonResponse, Path } from "typedapi.ts";

interface Order {
  id: number;
  customer: string;
  status: "draft" | "paid" | "shipped";
}

const orders = new Map<number, Order>([
  [1, { id: 1, customer: "Acme Corp", status: "draft" }],
]);

const createOrder = api(
  { method: "POST", path: "/orders" },
  async (params: {
    customer: Json<string>;
    status: Json<Order["status"]>;
  }): Promise<JsonResponse<200, {}, Order>> => {
    const id = orders.size + 1;
    const order = { id, customer: params.customer, status: params.status };
    orders.set(id, order);
    return order;
  },
);

const getOrder = api(
  { method: "GET", path: "/orders/:id" },
  async (params: { id: Path<number> }) => {
    return orders.get(params.id) ?? { message: "Order not found" };
  },
);

const updateOrder = api(
  { method: "PUT", path: "/orders/:id" },
  async (params: {
    id: Path<number>;
    status: Json<Order["status"]>;
  }) => {
    const current = orders.get(params.id);
    if (!current) {
      return { message: "Order not found" };
    }
    const next = { ...current, status: params.status };
    orders.set(params.id, next);
    return next;
  },
);

const deleteOrder = api(
  { method: "DELETE", path: "/orders/:id" },
  async (params: { id: Path<number> }) => {
    const deleted = orders.delete(params.id);
    return { deleted, id: params.id };
  },
);

export default createRouter([
  createOrder,
  getOrder,
  updateOrder,
  deleteOrder,
]);
```

## Parameter Wrappers

Handler params are assembled from request data with this precedence:

`path > body > query > cookie > header`

### `Path<T, Meta>`

```ts
import { api, createRouter, Path } from "typedapi.ts";

const getInvoice = api(
  { method: "GET", path: "/accounts/:accountId/invoices/:invoiceId" },
  async (params: {
    accountId: Path<number>;
    invoiceId: Path<string>;
  }) => {
    return {
      accountId: params.accountId,
      invoiceId: params.invoiceId,
      issuedAt: "2026-03-01",
    };
  },
);

export default createRouter([getInvoice]);
```

### `Query<T, Meta>`

```ts
import { api, createRouter, Query } from "typedapi.ts";

const searchCatalog = api(
  { method: "GET", path: "/catalog/search" },
  async (params: {
    q: Query<string>;
    page: Query<number>;
    tags: Query<string[]>;
  }) => {
    return {
      keyword: params.q,
      page: params.page,
      tags: params.tags,
      total: 42,
    };
  },
);

export default createRouter([searchCatalog]);
```

### `Header<T, Meta>`

```ts
import { api, createRouter, Header } from "typedapi.ts";

const getProfile = api(
  { method: "GET", path: "/me" },
  async (params: {
    authorization: Header<string>;
    "x-trace-id": Header<string>;
  }) => {
    return {
      token: params.authorization.replace("Bearer ", ""),
      traceId: params["x-trace-id"],
    };
  },
);

export default createRouter([getProfile]);
```

### `Cookie<T, Meta>`

```ts
import { api, createRouter, Cookie } from "typedapi.ts";

const getCart = api(
  { method: "GET", path: "/cart" },
  async (params: {
    session: Cookie<string>;
    locale: Cookie<string>;
  }) => {
    return {
      session: params.session,
      locale: params.locale ?? "en-US",
      items: 3,
    };
  },
);

export default createRouter([getCart]);
```

### `Json<T, Meta>`

```ts
import { api, createRouter, Json, JsonResponse } from "typedapi.ts";

interface Ticket {
  id: number;
  title: string;
  priority: "low" | "medium" | "high";
}

const createTicket = api(
  { method: "POST", path: "/tickets" },
  async (params: {
    title: Json<string>;
    priority: Json<Ticket["priority"]>;
  }): Promise<JsonResponse<200, {}, Ticket>> => {
    return {
      id: 101,
      title: params.title,
      priority: params.priority,
    };
  },
);

export default createRouter([createTicket]);
```

### `Form<T, Meta>`

`Form` supports both `application/x-www-form-urlencoded` and `multipart/form-data`. File fields remain `File` objects. Repeated keys become arrays.

```ts
import { api, createRouter, type Form } from "typedapi.ts";

const submitForm = api(
  { method: "POST", path: "/contact" },
  async (params: {
    name: Form<string>;
    email: Form<string>;
    message: Form<string>;
  }) => {
    return { received: true, name: params.name };
  },
);

export default createRouter([submitForm]);
```

## Request Context

Use `requestSymbol` when you need the raw `Request`.

```ts
import {
  api,
  createRouter,
  requestSymbol,
  type RequestContext,
} from "typedapi.ts";

const info = api(
  { method: "GET", path: "/info" },
  async (params: { [requestSymbol]: RequestContext }) => {
    const req = params[requestSymbol];
    return { url: req.url, method: req.method };
  },
);

export default createRouter([info]);
```

## Response Auto-Conversion

`api()` converts handler results to `Response` automatically:

| Handler return value | Response behavior |
| --- | --- |
| `Response` | passthrough |
| `null` | `204 No Content` |
| `string` | `text/plain; charset=utf-8` |
| `URL` | `307` redirect |
| `ReadableStream` | `application/octet-stream` |
| `AsyncIterable` | `text/event-stream` |
| anything else | JSON response |

```ts
import { api, createRouter, text } from "typedapi.ts";

const items = new Map<number, { id: number }>();

const health = api(
  { method: "GET", path: "/health" },
  async () => text("ok", 200, { "x-service": "typedapi-ts" }),
);

const greet = api(
  { method: "GET", path: "/greet" },
  async () => "hello world",
);

const deleteItem = api(
  { method: "DELETE", path: "/items/:id" },
  async (params: { id: number }) => {
    items.delete(params.id);
    return null;
  },
);

const download = api(
  { method: "GET", path: "/download" },
  async () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello\n"));
        controller.close();
      },
    }),
);

const events = api(
  { method: "GET", path: "/events" },
  async function* () {
    yield { type: "ping" };
    yield { type: "data", payload: 42 };
  },
);

const getUser = api(
  { method: "GET", path: "/users/:id" },
  async (params: { id: number }) => ({
    id: params.id,
    name: "Alice",
  }),
);

export default createRouter([
  health,
  greet,
  deleteItem,
  download,
  events,
  getUser,
]);
```

Returning a `URL` also redirects automatically:

```ts
import { api, createRouter } from "typedapi.ts";

const goToDocs = api(
  { method: "GET", path: "/docs" },
  async () => new URL("https://example.com/docs"),
);

export default createRouter([goToDocs]);
```

## Response Helpers

### `json()`

```ts
import { api, createRouter, json, type JsonResponse } from "typedapi.ts";

type CreateUserResult =
  | JsonResponse<201, { location: string }, { id: number; name: string }>
  | JsonResponse<409, {}, { message: string }>;

const createUser = api(
  { method: "POST", path: "/users" },
  async (): Promise<CreateUserResult> =>
    json({ id: 1, name: "Alice" }, 201, { location: "/users/1" }),
);

export default createRouter([createUser]);
```

### `html()`

```ts
import { api, createRouter, html } from "typedapi.ts";

const renderDashboard = api(
  { method: "GET", path: "/dashboard" },
  async () =>
    html(`<!doctype html>
    <html lang="en">
      <body>
        <h1>Revenue Dashboard</h1>
        <p>Updated at 2026-03-19T09:00:00Z</p>
      </body>
    </html>`),
);

export default createRouter([renderDashboard]);
```

### `text()`

```ts
import { api, createRouter, text } from "typedapi.ts";

const exportRobots = api(
  { method: "GET", path: "/robots.txt" },
  async () =>
    text("User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml"),
);

export default createRouter([exportRobots]);
```

### `stream()`

```ts
import { api, createRouter, stream } from "typedapi.ts";

const encoder = new TextEncoder();

const downloadReport = api(
  { method: "GET", path: "/reports/daily.csv" },
  async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("date,revenue\n"));
        controller.enqueue(encoder.encode("2026-03-18,18200\n"));
        controller.enqueue(encoder.encode("2026-03-19,19450\n"));
        controller.close();
      },
    });

    return stream(body, 200, {
      "content-disposition": "attachment; filename=daily.csv",
    });
  },
);

export default createRouter([downloadReport]);
```

### `sse()`

```ts
import { api, createRouter, sse } from "typedapi.ts";

async function* salesFeed() {
  yield { store: "tokyo", total: 1280 };
  yield { store: "osaka", total: 1315 };
  yield { store: "nagoya", total: 1272 };
}

const streamSales = api(
  { method: "GET", path: "/events/sales" },
  async () =>
    sse(salesFeed(), {
      "x-stream-name": "sales-feed",
    }),
);

export default createRouter([streamSales]);
```

### `redirect()`

```ts
import { api, createRouter, redirect } from "typedapi.ts";

const legacyRedirect = api(
  { method: "GET", path: "/old-path" },
  async () => redirect("/new-path"),
);

const autoRedirect = api(
  { method: "GET", path: "/go" },
  async () => new URL("https://example.com"),
);

export default createRouter([legacyRedirect, autoRedirect]);
```

`redirect()` defaults to status `307`.

### `file()`

```ts
import { api, createRouter, file } from "typedapi.ts";

const serveFavicon = api(
  { method: "GET", path: "/favicon.ico" },
  async () => file("./public/favicon.ico"),
);

const serveWithType = api(
  { method: "GET", path: "/data.csv" },
  async () =>
    file("./exports/data.csv", {
      contentType: "text/csv",
      headers: { "content-disposition": "attachment; filename=data.csv" },
    }),
);

export default createRouter([serveFavicon, serveWithType]);
```

`file()` infers the MIME type from the file extension unless `contentType` is provided explicitly.

## Cookie Helpers

`json()`, `html()`, `text()`, `stream()`, `sse()`, and `file()` accept `headers` values as `string` or `string[]`. Arrays are useful for repeated `Set-Cookie` headers.

```ts
import { api, cookie, clearCookie, json } from "typedapi.ts";

const signIn = api(
  { method: "POST", path: "/sessions" },
  async () =>
    json(
      { ok: true },
      200,
      {
        "set-cookie": [
          cookie("session", "token-123", {
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          }),
          cookie("refresh", "token-456", {
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          }),
        ],
      },
    ),
);

const signOut = api(
  { method: "DELETE", path: "/sessions" },
  async () =>
    json(
      { ok: true },
      200,
      {
        "set-cookie": clearCookie("session", {
          path: "/",
        }),
      },
    ),
);
```

Notes:

- `cookie()` URL-encodes the name and value.
- `sameSite: "None"` automatically adds `Secure`.
- `clearCookie()` sets `Max-Age=0` and the Unix epoch `Expires` date.

## Middleware And Route Groups

Middleware signature:

```ts
(next) => (params) => Response | Promise<Response>
```

Middleware can read params, short-circuit, or call `next()`.

```ts
import { api, createRouter, Header, middleware } from "typedapi.ts";

const auth = middleware((next) =>
  async (params: { authorization: Header<string> }) => {
    if (!params.authorization?.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return next();
  },
);

const getSecret = api(
  { method: "GET", path: "/secret", middlewares: [auth] },
  async () => ({ secret: 42 }),
);

export default createRouter([getSecret]);
```

Multiple middleware entries run in onion order:

```ts
import { api, type Middleware } from "typedapi.ts";

const timing: Middleware = (next) =>
  async (_params: {}) => {
    const start = Date.now();
    const res = await next();
    console.log(`${Date.now() - start}ms`);
    return res;
  };

const auth: Middleware = (next) =>
  async (_params: {}) => next();

const getUsers = api(
  { method: "GET", path: "/users", middlewares: [timing, auth] },
  async () => [{ id: 1 }],
);
```

`routes()` groups routes under shared prefix and middleware:

```ts
import { api, routes, createRouter, type Middleware } from "typedapi.ts";

const auth: Middleware = (next) =>
  async (params: { authorization: string }) => {
    if (!params.authorization) {
      return new Response("Unauthorized", { status: 401 });
    }
    return next();
  };

const getUsers = api(
  { method: "GET", path: "/users" },
  async () => [{ id: 1 }],
);

const getItems = api(
  { method: "GET", path: "/items" },
  async () => [{ id: 2 }],
);

const apiRoutes = routes({ prefix: "/api", middlewares: [auth] }, getUsers, getItems);

export default createRouter(apiRoutes);
```

Nested groups stack both prefix and middleware:

```ts
import { api, routes, type Middleware } from "typedapi.ts";

const auth: Middleware = (next) =>
  async (_params: {}) => next();

const logging: Middleware = (next) =>
  async (_params: {}) => {
    console.log("request");
    return next();
  };

const getUsers = api(
  { method: "GET", path: "/users" },
  async () => [{ id: 1 }],
);

const v1Routes = routes({ prefix: "/v1", middlewares: [auth] }, getUsers);
const allRoutes = routes({ prefix: "/api", middlewares: [logging] }, ...v1Routes);
```

Group middleware runs before route middleware:

```ts
import { api, routes, type Middleware } from "typedapi.ts";

const auth: Middleware = (next) =>
  async (_params: {}) => next();

const rateLimit: Middleware = (next) =>
  async (_params: {}) => next();

const protectedRoutes = routes(
  { middlewares: [auth] },
  api(
    { method: "POST", path: "/orders", middlewares: [rateLimit] },
    async (params: { item: string }) => ({ item: params.item }),
  ),
);
```

When the transformer is enabled, `middleware()` can contribute parameter and response metadata to OpenAPI docs. Route-level metadata wins on conflicts.

## CORS

Use `cors()` as middleware on a route or a route group:

```ts
import { api, createRouter, cors, routes } from "typedapi.ts";

const health = api(
  { method: "GET", path: "/health", middlewares: [cors()] },
  async () => ({ status: "ok" }),
);

const apiRoutes = routes(
  {
    prefix: "/api",
    middlewares: [
      cors({
        origin: ["https://app.example.com"],
        credentials: true,
        maxAge: 3600,
      }),
    ],
  },
  health,
);

export default createRouter(apiRoutes);
```

`CorsOptions`:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `origin` | `string \| string[] \| ((origin: string) => boolean)` | `"*"` | allowed origins |
| `methods` | `string[]` | `["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]` | allowed methods |
| `allowHeaders` | `string[]` | none | allowed request headers |
| `exposeHeaders` | `string[]` | none | exposed response headers |
| `credentials` | `boolean` | none | whether credentials are allowed |
| `maxAge` | `number` | none | preflight cache seconds |

## Error Handling

Throw `HttpError` in handlers or middleware for controlled responses:

```ts
import { api, createRouter, HttpError, Path } from "typedapi.ts";

const orders = new Map<number, { id: number; customer: string }>([
  [1, { id: 1, customer: "Acme Corp" }],
]);

const getOrder = api(
  { method: "GET", path: "/orders/:id" },
  async (params: { id: Path<number> }) => {
    const order = orders.get(params.id);
    if (!order) {
      throw new HttpError(404, "Order not found");
    }
    return order;
  },
);

export default createRouter([getOrder]);
```

Constructor shape:

```ts
new HttpError(status, body?, headers?)
```

Examples:

```ts
throw new HttpError(403);
throw new HttpError(404, "User not found");
throw new HttpError(422, {
  message: "Validation failed",
  errors: ["field required"],
});
throw new HttpError(401, "Unauthorized", {
  "WWW-Authenticate": "Bearer",
});
```

Unhandled non-`HttpError` exceptions become:

```json
{ "message": "Internal Server Error" }
```

with status `500`.

### Group-Level `onError`

`routes()` supports group-specific error handling. Use `handleError()` as a fallback when you want the framework default behavior for unrecognized exceptions.

```ts
import { api, routes, createRouter, handleError } from "typedapi.ts";

class ValidationError extends Error {
  fields: string[];

  constructor(fields: string[]) {
    super("Validation failed");
    this.fields = fields;
  }
}

const apiRoutes = routes(
  {
    prefix: "/api",
    onError: (error, _request) => {
      if (error instanceof ValidationError) {
        return Response.json(
          { message: error.message, fields: error.fields },
          { status: 422 },
        );
      }

      return handleError(error);
    },
  },
  api({ method: "POST", path: "/users" }, async (params: { name: string }) => {
    if (!params.name) throw new ValidationError(["name"]);
    return { id: 1, name: params.name };
  }),
);

export default createRouter(apiRoutes);
```

## Dependency Injection

`inject()` declares request-scoped dependencies. Use `Inject<typeof dependency>` in handler params.

### Generator-based injection with cleanup

```ts
import { api, createRouter, inject, type Inject, type Path } from "typedapi.ts";

const db = inject(async function* () {
  const client = await connectDb();
  yield client;
  await client.close();
});

const requestId = inject(async () => crypto.randomUUID());

const getUser = api(
  { method: "GET", path: "/users/:id" },
  async (params: {
    id: Path<number>;
    db: Inject<typeof db>;
    requestId: Inject<typeof requestId>;
  }) => {
    console.log("Request:", params.requestId);
    return params.db.query("SELECT * FROM users WHERE id = $1", [params.id]);
  },
);

export default createRouter([getUser]);
```

Behavior:

1. When the route defines `validate`, request-sourced params are validated first.
2. The framework resolves injectables for the request.
3. Resolved values are merged into the handler `params`.
4. Generator cleanup runs after the request in reverse order, even on errors.

`cache: true` is the default. Set `cache: false` when you need a fresh value for each usage.

### `RequestParams<T>`

Use `RequestParams<T>` when a handler param type includes `Inject<typeof dependency>` fields and the route also uses runtime validation. It removes properties branded with `__inject`, so Typia only validates request-sourced fields.

## Typed Injectable Metadata

`inject()` handlers can also use wrapper types and `JsonResponse` so they can participate in OpenAPI metadata generation.

```ts
import {
  api,
  createRouter,
  HttpError,
  inject,
  type Header,
  type Inject,
  type JsonResponse,
  type Path,
} from "typedapi.ts";

const auth = inject(
  async (params: {
    authorization: Header<string>;
  }): Promise<JsonResponse<401, {}, { message: string }>> => {
    const token = params.authorization?.replace("Bearer ", "");
    if (!token) throw new HttpError(401, "Unauthorized");
    return { userId: token };
  },
);

const getUser = api(
  { method: "GET", path: "/users/:id", expose: true },
  async (params: {
    id: Path<number>;
    auth: Inject<typeof auth>;
  }) => {
    return { id: params.id, userId: params.auth.userId };
  },
);

export default createRouter([getUser]);
```

OpenAPI merge precedence is:

`middleware < inject < route`

## Compile-Time Metadata Extraction

With the transformer enabled, typedapi analyzes handler types at compile time:

- `api()` reads the first handler parameter type and generates `parameters`
- `api()` reads `JsonResponse` return types and generates `responses`
- `middleware()` reads the inner handler parameter type and return type the same way
- `inject()` can contribute parameter and response metadata through typed params and `JsonResponse`
- manually supplied `parameters` or `responses` are preserved

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

### Wrapper Metadata For OpenAPI

The second generic on wrapper types is metadata used for OpenAPI:

```ts
import {
  api,
  createRouter,
  Cookie,
  Header,
  Json,
  JsonResponse,
  Path,
  Query,
} from "typedapi.ts";

interface Product {
  id: number;
  name: string;
  price: number;
}

interface UpdateProductParams {
  id: Path<number, { title: "Product ID"; example: 42 }>;
  currency?: Query<
    string,
    {
      title: "Currency";
      description: "ISO 4217 currency code";
    }
  >;
  name: Json<string, { title: "Product name" }>;
  price: Json<
    number,
    {
      title: "Product price";
      description: "Integer price in cents";
      example: 9900;
    }
  >;
  authorization: Header<
    string,
    {
      alias: "Authorization";
      title: "Access token";
    }
  >;
  "x-api-version": Header<
    string,
    {
      title: "API version";
      deprecated: true;
      description: "Move to URL versioning before v3";
    }
  >;
  storeId: Cookie<
    string,
    {
      alias: "x-store-id";
      title: "Store ID";
    }
  >;
}

const updateProduct = api(
  { method: "PUT", path: "/products/:id", expose: true },
  async (params: UpdateProductParams): Promise<JsonResponse<200, {}, Product>> => {
    return { id: params.id, name: params.name, price: params.price };
  },
);

export default createRouter([updateProduct]);
```

Supported metadata keys:

- `title`
- `description`
- `alias`
- `example`
- `deprecated`

## OpenAPI 3.1 Generation

Use `openapi()` to build a document from routes with `expose: true`.

```ts
import { api, openapi, type Json, type JsonResponse } from "typedapi.ts";

interface Order {
  id: number;
  customer: string;
}

interface Message {
  message: string;
}

interface CreateOrderParams {
  customer: Json<string>;
}

const createOrder = api(
  { method: "POST", path: "/orders", expose: true },
  async (_params: CreateOrderParams): Promise<
    | JsonResponse<201, {}, Order>
    | JsonResponse<400, {}, Message>
  > => {
    return { id: 1, customer: "Acme Corp" };
  },
);

const document = openapi({
  info: {
    title: "Orders API",
    version: "1.0.0",
  },
  servers: [{ url: "https://api.example.com" }],
  routes: [createOrder],
});
```

Generated output includes:

- `paths`
- path parameters, including `:id -> {id}`
- query, header, and cookie parameters
- JSON `requestBody`
- JSON `responses` from `JsonResponse`
- `components.schemas`

If an exposed route has no response schema, `openapi()` emits a default empty `200` response.

## Runtime Validation With Typia

Use `typia.createValidate<RequestParams<T>>()` in the third `api()` argument when runtime validation is needed. Import `typia` in every file that passes `validate` to `api()`.

```ts
import typia from "typia";
import {
  api,
  createRouter,
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
    return {
      id: params.id,
      name: params.body.name,
    };
  },
  {
    validate: typia.createValidate<RequestParams<CreateUserParams>>(),
  },
);

export default createRouter([createUser]);
```

The validator shape used by `api()` is compatible with the exported `Validate<RequestParams<T>>` type.

Runtime order is `validate -> inject -> handler`. Validation failures return `400` before injectables are resolved.

The third `api()` argument also accepts manual `responses`, `parameters`, and `inject` entries when needed.
