# typedapi.ts

基于标准 fetch 接口的类型安全 Web 框架，使用 Typia 进行运行时校验。

## 安装

```bash
npm install typedapi.ts
```

### TypeScript Transform 配置

安装 [ts-patch](https://github.com/nonara/ts-patch) 以启用编译期自动 OpenAPI 生成：

```bash
npm install -D ts-patch
npx ts-patch install
```

在 `tsconfig.json` 中添加插件：

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "typedapi.ts/transform" }
    ]
  }
}
```

配置后，框架会在编译时自动从 handler 的参数类型和返回类型生成 OpenAPI 参数与响应 schema，无需手动声明。

### 运行时验证

安装 [typia](https://typia.io)：

```bash
npm install typia
```

在 `tsconfig.json` 中添加 typia 插件（**必须在 typedapi.ts transform 之后**）：

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

## 启动服务

`createRouter()` 返回标准 `(request: Request) => Promise<Response>` 签名，直接 `export default` 即可部署到 Cloudflare Workers：

```typescript
import { api, createRouter } from "typedapi.ts";

const health = api({ method: "GET", path: "/health" }, async () => {
  return { status: "ok" };
});

export default createRouter([health]);
```

## 用法

### 基础 CRUD

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

### Path 参数

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

### Query 参数

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

### Header 参数

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

### Cookie 参数

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

### JSON 请求体

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

### Form 请求体

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

支持 `application/x-www-form-urlencoded` 和 `multipart/form-data`。multipart 中文件字段会作为 `File` 对象传入。

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

### 响应自动转换

`api()` 会把 handler 的返回值自动转换为 `Response`：

| 返回值 | 响应 |
| --- | --- |
| `Response` | 原样透传 |
| `null` | `204 No Content` |
| `string` | `text/plain; charset=utf-8` |
| `URL` | `307 重定向` |
| `ReadableStream` | `application/octet-stream` |
| `AsyncIterable` | `text/event-stream` |
| 其他值 | JSON 响应 |

```typescript
import { api, createRouter, text } from "typedapi.ts";

const items = new Map<number, { id: number }>();

// Response → 原样透传
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

### JSON 响应

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

### HTML 响应

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

### 纯文本响应

```typescript
import { api, createRouter, text } from "typedapi.ts";

const exportRobots = api(
  { method: "GET", path: "/robots.txt" },
  async () =>
    text("User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml"),
);

export default createRouter([exportRobots]);
```

### Set-Cookie 序列化

`json()` / `html()` / `text()` / `stream()` / `sse()` / `file()` 的 `headers` 参数支持 `string` 和 `string[]`。传入数组时会追加同名 header，适合多个 `Set-Cookie`；显式传入 `content-type` 会覆盖默认值。

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

### 流式响应

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

### SSE（Server-Sent Events）

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

### Redirect 响应

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

### 静态文件响应

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

中间件签名：`(next) => (params) => Response`。中间件可以读取请求参数、提前返回、或调用 `next()` 继续执行。

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

启用 transformer 后，`middleware()` 的 handler 参数类型和 inner handler 返回类型会像 `api()` 一样在编译期自动提取。中间件里的参数与响应元数据会合并到使用该中间件的每个 endpoint 的 OpenAPI 文档中；如果与路由自身参数重复，则以路由级参数为准；如果响应状态码重复，则以路由级响应为准。

多个中间件按数组顺序执行（洋葱模型），每个都可以在 `next()` 前后插入逻辑：

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

### Routes 聚合

`routes()` 将多个路由聚合为一组，支持共享前缀和中间件：

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

// /api/users 和 /api/items 都会经过 auth 中间件
const apiRoutes = routes({ prefix: "/api", middlewares: [auth] }, getUsers, getItems);

export default createRouter(apiRoutes);
```

嵌套聚合时前缀叠加、中间件从外到内依次执行：

```typescript
const logging: Middleware = (next) =>
  async (_params: {}) => {
    console.log("request");
    return next();
  };

const v1Routes = routes({ prefix: "/v1", middlewares: [auth] }, getUsers);
// 最终路径: /api/v1/users
// 执行顺序: logging → auth → handler
const allRoutes = routes({ prefix: "/api", middlewares: [logging] }, ...v1Routes);

export default createRouter(allRoutes);
```

routes 级别的中间件在 route 自身中间件之前执行：

```typescript
const rateLimit: Middleware = (next) =>
  async (_params: {}) => next();

// 执行顺序: auth (来自 routes) → rateLimit (来自 route) → handler
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

`CorsOptions` 配置：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `origin` | `string \| string[] \| ((origin: string) => boolean)` | `"*"` | 允许的来源 |
| `methods` | `string[]` | `["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]` | 允许的 HTTP 方法 |
| `allowHeaders` | `string[]` | — | 允许的请求头（未配置时回显 `Access-Control-Request-Headers`） |
| `exposeHeaders` | `string[]` | — | 暴露给浏览器的响应头 |
| `credentials` | `boolean` | — | 是否允许携带凭证 |
| `maxAge` | `number` | — | preflight 缓存秒数 |

### 错误处理

在 handler 或 middleware 中抛出 `HttpError` 可返回受控的错误响应。未捕获的其他异常会自动转为 `500 Internal Server Error`。

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

`HttpError` 构造参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `number` | HTTP 状态码 |
| `body` | `string \| Record<string, unknown>` | 可选。字符串转为 `{ message }` JSON；对象原样输出；省略则无响应体 |
| `headers` | `Record<string, string>` | 可选。自定义响应头 |

```typescript
throw new HttpError(403);
// → 403, 无响应体

throw new HttpError(404, "User not found");
// → 404, { "message": "User not found" }

throw new HttpError(422, { message: "Validation failed", errors: ["field required"] });
// → 422, { "message": "Validation failed", "errors": ["field required"] }

throw new HttpError(401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
// → 401, { "message": "Unauthorized" }, WWW-Authenticate: Bearer
```

handler 或 middleware 中抛出的非 `HttpError` 异常会返回 `500`，不暴露内部错误信息：

```typescript
const crashRoute = api(
  { method: "GET", path: "/crash" },
  async () => { throw new Error("database failed"); },
);
// → 500, { "message": "Internal Server Error" }
```

### 自定义错误处理

`routes()` 支持 `onError` 选项，在路由组级别自定义错误处理。不同路由组可以有不同的错误处理策略：

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
      // 其他错误走默认处理（HttpError → 对应响应，其余 → 500）
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

`onError` 回调参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `error` | `unknown` | 捕获到的异常 |
| `request` | `Request` | 当前请求对象 |

未配置 `onError` 的路由组以及不在任何 `routes()` 中的独立路由，由 `createRouter` 的默认兜底逻辑处理（`HttpError` → 对应响应，其他 → `500`）。`handleError` 作为默认处理函数导出，可在自定义 `onError` 中作为 fallback 调用。

### 函数注入

`inject()` 用于声明 request-scoped 依赖。使用异步 generator 定义带有清理逻辑的资源（yield 前初始化，yield 后清理），或使用普通异步函数定义无清理的依赖。在 handler 参数类型中使用 `Inject<typeof X>` 标注即可自动注入。

```typescript
import { api, createRouter, inject, type Inject, type Path } from "typedapi.ts";

// 定义依赖 —— generator 方式（有清理逻辑）
const db = inject(async function* () {
  const client = await connectDb();
  yield client;
  await client.close();
}); // 默认 cache: true，同一请求内复用同一实例

// 定义依赖 —— 普通异步函数（无清理）
const requestId = inject(async () => crypto.randomUUID());

// 在 handler 参数类型中使用 Inject<typeof X> 标注，框架自动注入
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

编译时 transformer 会自动识别 `Inject<typeof X>` 类型标注，提取 injectable 变量引用，注入到路由配置中。运行时框架会在每次请求时自动：

1. 调用 inject 函数获取依赖值
2. 将依赖值合并到 handler 的 `params` 中
3. 请求结束后按逆序执行 generator 的清理代码（即使 handler 抛异常也会执行）

`cache` 选项控制同一请求内的复用行为：
- `cache: true`（默认）：同一个 injectable 在一次请求中只初始化一次，多处使用共享同一实例
- `cache: false`：每次使用都重新调用 inject 函数

### 带类型注解的依赖注入

`inject()` 的 handler 可以像 `api()` 和 `middleware()` 一样使用 `Path`、`Query`、`Header`、`Cookie`、`Json` 类型注解声明所需的请求参数，以及使用 `JsonResponse` 声明可能的错误响应。编译时 transformer 会自动提取参数与响应元数据，运行时框架会将已解析的请求参数传递给 inject 函数。inject 的参数与响应元数据会自动合并到使用该 inject 的路由的 OpenAPI 文档中（优先级：middleware < inject < route）。

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

### 编译时参数元数据注入

启用 `ts-patch` 后，把自定义 transformer 放在 `typia` 之前。编译时会直接分析 `api()` handler 的第一个参数类型，把参数元数据字面量注入到 `api()` 第三个参数的 `parameters` 字段里；同时会分析 `JsonResponse` 返回类型，把响应元数据字面量注入到 `responses` 字段里。编译时也会分析 `middleware()` outer handler 返回的 inner handler 第一个参数类型，把参数元数据字面量注入到 `middleware()` 第二个参数的 `parameters` 字段里，并从 inner handler 返回类型提取响应元数据注入到 `responses` 字段里。如果对应参数里已经手动提供了 `parameters` 或 `responses`，则不会覆盖。

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

### 参数元数据（OpenAPI）

`Path` / `Query` / `Header` / `Cookie` / `Json` 的 wrapper 元数据会在编译时自动提取并注入，不需要 `import typia`，也不需要 `ParamsSchema`。类型写法本身不变：

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
  id: Path<number, { title: "商品 ID"; example: 42 }>;
  currency?: Query<
    string,
    {
      title: "货币单位";
      description: "ISO 4217 货币代码";
    }
  >;
  name: Json<string, { title: "商品名称" }>;
  price: Json<
    number,
    {
      title: "商品价格";
      description: "以分为单位的整数价格";
      example: 9900;
    }
  >;
  authorization: Header<
    string,
    {
      alias: "Authorization";
      title: "访问令牌";
    }
  >;
  "x-api-version": Header<
    string,
    {
      title: "API 版本";
      deprecated: true;
      description: "请迁移到 URL 版本号，此 header 将在 v3 移除";
    }
  >;
  storeId: Cookie<
    string,
    {
      alias: "x-store-id";
      title: "店铺 ID";
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

OpenAPI 参数元数据来源：

- `title`、`description`、`alias`、`example`、`deprecated` 全部从 `Path<T, Meta>` / `Query<T, Meta>` / `Header<T, Meta>` / `Cookie<T, Meta>` / `Json<T, Meta>` 的第二个泛型参数 `Meta` 读取
- 编译时 transformer 会直接生成包含 `__entries` 和 `__body` 的参数元数据字面量
- `Inject<typeof injectable>` 类型标注会被 transformer 自动识别并生成 inject 配置，不会出现在 OpenAPI 参数文档中
- 可选属性不会进入 `required`

### 生成 OpenAPI 3.1 文档

`openapi()` 会遍历 `expose: true` 的路由，并读取编译时自动注入到 `api()` 第三个参数里的参数与响应元数据。对 `JsonResponse<Status, Headers, Body>`（包括 union）会自动生成 OpenAPI `responses`；如有需要，也可以继续手动传入 `{ parameters, responses }` 覆盖默认行为：

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
  /** @title 客户名称 */
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

生成结果为 OpenAPI 3.1 对象，当前包含：

- `paths`
- path parameters（`/orders/:id` -> `/orders/{id}`，无 `parameters` 时也会自动回退生成）
- query / header / cookie parameters（来自 transformer 注入的参数元数据字面量）
- JSON `requestBody`（来自 `Json<T>` 字段）
- JSON `responses`（来自 transformer 注入的 `JsonResponse` 元数据，也兼容手动传入的 typia schema）
- `components.schemas`

如果某个暴露路由没有挂载响应 schema，`openapi()` 会为它生成默认的 `200` 空响应。

### 运行时校验（Typia）

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

`api()` 的第三个参数使用 `{ validate, responses, parameters }` 格式。
