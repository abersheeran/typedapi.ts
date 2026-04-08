# typedapi.ts

A type-safe Web framework based on the standard fetch interface, using Typia for runtime validation.

## AI Skills

Install the [Agent Skill](https://agentskills.io) for AI-assisted development with typedapi.ts:

```bash
npx skills add abersheeran/typedapi.ts
```

This gives Claude Code, Cursor, GitHub Copilot, and other AI agents context about the framework's API, patterns, and conventions.

## Installation

```bash
npm install typedapi.ts
```

### TypeScript Transform Setup

Install [ts-patch](https://github.com/nonara/ts-patch) to enable automatic OpenAPI generation at compile time:

```bash
npm install -D ts-patch
npx ts-patch install
```

Add the plugin in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "typedapi.ts/transform" }
    ]
  }
}
```

With this configuration, the framework automatically generates OpenAPI parameter and response schemas from the handler's parameter types and return types at compile time, with no manual declarations required.

### Runtime Validation

Install [typia](https://typia.io):

```bash
npm install typia
```

Add the typia plugin in `tsconfig.json` (**it must come after the typedapi.ts transform**):

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

## Start the Server

`createRouter()` returns the standard `(request: Request) => Promise<Response>` signature, so you can deploy it to Cloudflare Workers by exporting it directly:

```typescript
import { api, createRouter } from "typedapi.ts";

const health = api({ method: "GET", path: "/health" }, async () => {
  return { status: "ok" };
});

export default createRouter([health]);
```

## Usage

### Basic CRUD

```typescript
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

### Path Parameters

```typescript
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

### Query Parameters

```typescript
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

### Header Parameters

```typescript
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

### Cookie Parameters

```typescript
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

### JSON Request Body

```typescript
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

### Form Request Body

```typescript
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

Supports `application/x-www-form-urlencoded` and `multipart/form-data`. In multipart requests, file fields are passed in as `File` objects.

### Request Context

```typescript
import { api, createRouter, requestSymbol, type RequestContext } from "typedapi.ts";

const info = api(
  { method: "GET", path: "/info" },
  async (params: { [requestSymbol]: RequestContext }) => {
    const req = params[requestSymbol];
    return { url: req.url, method: req.method };
  },
);

export default createRouter([info]);
```

### Automatic Response Conversion

`api()` automatically converts the handler's return value into a `Response`:

| Return Value | Response |
| --- | --- |
| `Response` | Passed through unchanged |
| `null` | `204 No Content` |
| `string` | `text/plain; charset=utf-8` |
| `URL` | `307 Redirect` |
| `ReadableStream` | `application/octet-stream` |
| `AsyncIterable` | `text/event-stream` |
| Any other value | JSON response |

```typescript
import { api, createRouter, text } from "typedapi.ts";

const items = new Map<number, { id: number }>();

// Response → passed through unchanged
const health = api(
  { method: "GET", path: "/health" },
  async () => text("ok", 200, { "x-service": "typedapi-ts" }),
);

// string → text/plain
const greet = api(
  { method: "GET", path: "/greet" },
  async () => "hello world",
);

// null → 204 No Content
const deleteItem = api(
  { method: "DELETE", path: "/items/:id" },
  async (params: { id: number }) => {
    items.delete(params.id);
    return null;
  },
);

// ReadableStream → application/octet-stream
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

// AsyncIterable → SSE (text/event-stream)
const events = api(
  { method: "GET", path: "/events" },
  async function* () {
    yield { type: "ping" };
    yield { type: "data", payload: 42 };
  },
);

// object → JSON (default)
const getUser = api(
  { method: "GET", path: "/users/:id" },
  async (params: { id: number }) => ({
    id: params.id,
    name: "Alice",
  }),
);

export default createRouter([health, greet, deleteItem, download, events, getUser]);
```

```typescript
import { api, createRouter } from "typedapi.ts";

const goToDocs = api(
  { method: "GET", path: "/docs" },
  async () => new URL("https://example.com/docs"),
);

export default createRouter([goToDocs]);
```

### JSON Responses

```typescript
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

### HTML Responses

```typescript
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

### Plain Text Responses

```typescript
import { api, createRouter, text } from "typedapi.ts";

const exportRobots = api(
  { method: "GET", path: "/robots.txt" },
  async () =>
    text("User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml"),
);

export default createRouter([exportRobots]);
```

### Set-Cookie Serialization

The `headers` parameter of `json()` / `html()` / `text()` / `stream()` / `sse()` / `file()` supports both `string` and `string[]`. When an array is passed, headers with the same name are appended, which is useful for multiple `Set-Cookie` values; explicitly passing `content-type` overrides the default.

```typescript
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

### Streaming Responses

```typescript
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

### SSE (Server-Sent Events)

```typescript
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

### Redirect Responses

```typescript
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

### Static File Responses

```typescript
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

### Middleware

Middleware signature: `(next) => (params) => Response`. Middleware can read request parameters, return early, or call `next()` to continue execution.

```typescript
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

With the transformer enabled, the parameter type of the `middleware()` handler and the return type of the inner handler are automatically extracted at compile time just like `api()`. Parameter and response metadata declared in middleware are merged into the OpenAPI document of every endpoint that uses that middleware; if they duplicate route-level parameters, the route-level parameters take precedence; if response status codes overlap, the route-level responses take precedence.

Multiple middlewares run in array order using the onion model, and each one can insert logic before and after `next()`:

```typescript
const timing: Middleware = (next) =>
  async (_params: {}) => {
    const start = Date.now();
    const res = await next();
    console.log(`${Date.now() - start}ms`);
    return res;
  };

const getUsers = api(
  { method: "GET", path: "/users", middlewares: [timing, auth] },
  async () => [{ id: 1 }],
);
```

### Route Grouping

`routes()` groups multiple routes together, with support for shared prefixes and middlewares:

```typescript
import { api, routes, createRouter, Header, type Middleware } from "typedapi.ts";

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

// Both /api/users and /api/items go through the auth middleware
const apiRoutes = routes({ prefix: "/api", middlewares: [auth] }, getUsers, getItems);

export default createRouter(apiRoutes);
```

When groups are nested, prefixes are combined and middlewares run from outermost to innermost:

```typescript
const logging: Middleware = (next) =>
  async (_params: {}) => {
    console.log("request");
    return next();
  };

const v1Routes = routes({ prefix: "/v1", middlewares: [auth] }, getUsers);
// Final path: /api/v1/users
// Execution order: logging → auth → handler
const allRoutes = routes({ prefix: "/api", middlewares: [logging] }, ...v1Routes);

export default createRouter(allRoutes);
```

Route-group-level middleware runs before the middleware defined on the individual route itself:

```typescript
const rateLimit: Middleware = (next) =>
  async (_params: {}) => next();

// Execution order: auth (from routes) → rateLimit (from route) → handler
const protectedRoutes = routes(
  { middlewares: [auth] },
  api(
    { method: "POST", path: "/orders", middlewares: [rateLimit] },
    async (params: { item: string }) => ({ item: params.item }),
  ),
);
```

### CORS

```typescript
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

`CorsOptions` configuration:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `origin` | `string \| string[] \| ((origin: string) => boolean)` | `"*"` | Allowed origins |
| `methods` | `string[]` | `["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]` | Allowed HTTP methods |
| `allowHeaders` | `string[]` | — | Allowed request headers (if unset, echoes `Access-Control-Request-Headers`) |
| `exposeHeaders` | `string[]` | — | Response headers exposed to the browser |
| `credentials` | `boolean` | — | Whether credentials are allowed |
| `maxAge` | `number` | — | Number of seconds to cache preflight responses |

### Error Handling

Throwing `HttpError` in a handler or middleware returns a controlled error response. Any other uncaught exception is automatically converted into `500 Internal Server Error`.

```typescript
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

`HttpError` constructor parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `status` | `number` | HTTP status code |
| `body` | `string \| Record<string, unknown>` | Optional. Strings are converted to `{ message }` JSON; objects are returned as-is; if omitted, there is no response body |
| `headers` | `Record<string, string>` | Optional. Custom response headers |

```typescript
throw new HttpError(403);
// → 403, no body

throw new HttpError(404, "User not found");
// → 404, { "message": "User not found" }

throw new HttpError(422, { message: "Validation failed", errors: ["field required"] });
// → 422, { "message": "Validation failed", "errors": ["field required"] }

throw new HttpError(401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
// → 401, { "message": "Unauthorized" }, WWW-Authenticate: Bearer
```

Non-`HttpError` exceptions thrown in handlers or middleware return `500` without exposing internal error details:

```typescript
const crashRoute = api(
  { method: "GET", path: "/crash" },
  async () => { throw new Error("database failed"); },
);
// → 500, { "message": "Internal Server Error" }
```

### Custom Error Handling

`routes()` supports an `onError` option for customizing error handling at the route-group level. Different route groups can use different error-handling strategies:

```typescript
import { api, routes, createRouter, handleError, HttpError } from "typedapi.ts";

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
    onError: (error, request) => {
      if (error instanceof ValidationError) {
        return Response.json(
          { message: error.message, fields: error.fields },
          { status: 422 },
        );
      }
      // Fall back to default handling for other errors (HttpError → matching response, others → 500)
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

`onError` callback parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `error` | `unknown` | The captured exception |
| `request` | `Request` | The current request object |

Route groups without `onError`, as well as standalone routes not included in any `routes()`, are handled by `createRouter`'s default fallback logic (`HttpError` -> corresponding response, everything else -> `500`). `handleError` is exported as the default handler and can be called as a fallback inside custom `onError` implementations.

### Dependency Injection

`inject()` is used to declare request-scoped dependencies. You can define resources with cleanup logic using an async generator (initialize before `yield`, clean up after `yield`), or define dependencies without cleanup using a regular async function. Annotate a handler parameter with `Inject<typeof X>` to have it injected automatically.

```typescript
import { api, createRouter, inject, type Inject, type Path } from "typedapi.ts";

// Define dependency — generator pattern (with cleanup)
const db = inject(async function* () {
  const client = await connectDb();
  yield client;
  await client.close();
}); // Defaults to cache: true — reuses the same instance within a request

// Define dependency — plain async function (no cleanup)
const requestId = inject(async () => crypto.randomUUID());

// Annotate handler params with Inject<typeof X> for automatic injection
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

At compile time, the transformer automatically recognizes `Inject<typeof X>` type annotations, extracts references to injectable variables, and injects them into the route configuration. At runtime, the framework automatically does the following for each request:

1. Call the inject function to obtain the dependency value
2. Merge the dependency value into the handler's `params`
3. Execute generator cleanup code in reverse order after the request finishes (even if the handler throws)

The `cache` option controls reuse within the same request:
- `cache: true` (default): the same injectable is initialized only once per request, and all usages share the same instance
- `cache: false`: the inject function is called again each time it is used

### Typed Dependency Injection

`inject()` handlers can declare required request parameters using `Path`, `Query`, `Header`, `Cookie`, and `Json` type annotations, just like `api()` and `middleware()`, and can also declare possible error responses with `JsonResponse`. The transformer automatically extracts parameter and response metadata at compile time, and at runtime the framework passes parsed request parameters into the inject function. Parameter and response metadata from `inject()` are automatically merged into the OpenAPI document of routes that use that inject function (precedence: `middleware` < `inject` < `route`).

```typescript
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

### Compile-Time Parameter Metadata Injection

With `ts-patch` enabled, place the custom transformer before `typia`. At compile time, it directly analyzes the type of the first parameter of an `api()` handler and injects parameter metadata literals into the `parameters` field of `api()`'s third argument; it also analyzes the `JsonResponse` return type and injects response metadata literals into the `responses` field. It also analyzes the type of the first parameter of the inner handler returned by the `middleware()` outer handler, injects parameter metadata literals into the `parameters` field of `middleware()`'s second argument, and extracts response metadata from the inner handler's return type into `responses`. If `parameters` or `responses` are already provided manually, they are not overwritten.

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "./transform.cjs" },
      { "transform": "typia/lib/transform" }
    ]
  }
}
```

### Parameter Metadata (OpenAPI)

Wrapper metadata for `Path` / `Query` / `Header` / `Cookie` / `Json` is automatically extracted and injected at compile time. There is no need to `import typia` or use `ParamsSchema`. The type syntax itself stays the same:

```typescript
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
      description: "Please migrate to URL versioning; this header will be removed in v3";
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

Sources of OpenAPI parameter metadata:

- `title`, `description`, `alias`, `example`, and `deprecated` are all read from the second generic parameter `Meta` of `Path<T, Meta>` / `Query<T, Meta>` / `Header<T, Meta>` / `Cookie<T, Meta>` / `Json<T, Meta>`
- The compile-time transformer directly generates parameter metadata literals containing `__entries` and `__body`
- `Inject<typeof injectable>` type annotations are automatically recognized by the transformer and converted into inject configuration, and do not appear in OpenAPI parameter documentation
- Optional properties are not added to `required`

### Generating OpenAPI 3.1 Documents

`openapi()` traverses routes with `expose: true` and reads the parameter and response metadata automatically injected at compile time into the third argument of `api()`. For `JsonResponse<Status, Headers, Body>` (including unions), it automatically generates OpenAPI `responses`; if needed, you can still manually pass `{ parameters, responses }` to override the default behavior:

```typescript
import { api, openapi, type JsonResponse, type Json } from "typedapi.ts";

interface Order {
  id: number;
  customer: string;
}

interface Message {
  message: string;
}

interface CreateOrderParams {
  /** @title Customer name */
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

The generated result is an OpenAPI 3.1 object and currently includes:

- `paths`
- path parameters (`/orders/:id` -> `/orders/{id}`; if `parameters` are absent, they are generated as a fallback automatically)
- query / header / cookie parameters (from parameter metadata literals injected by the transformer)
- JSON `requestBody` (from `Json<T>` fields)
- JSON `responses` (from `JsonResponse` metadata injected by the transformer, also compatible with manually provided typia schemas)
- `components.schemas`

If an exposed route has no response schema attached, `openapi()` generates a default empty `200` response for it.

### Runtime Validation (Typia)

```typescript
import typia from "typia";
import { api, createRouter, Json, Path, Query } from "typedapi.ts";

type UpdateSeatParams = {
  eventId: Path<number>;
  notify: Query<boolean>;
  seat: Json<string>;
  price: Json<number>;
};

const updateSeat = api(
  { method: "PUT", path: "/events/:eventId/seats" },
  async (params: UpdateSeatParams) => {
    return {
      eventId: params.eventId,
      notify: params.notify,
      seat: params.seat,
      price: params.price,
    };
  },
  {
    validate: typia.createValidate<UpdateSeatParams>(),
  },
);

export default createRouter([updateSeat]);
```

The third argument to `api()` uses the `{ validate, responses, parameters }` shape.
