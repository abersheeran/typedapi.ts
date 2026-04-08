# Fetch Framework PRD

## 目标

提供一个基于标准 `Request` / `Response` / `fetch` 接口的 TypeScript Web 框架，用最少的 API 支撑声明式路由、参数提取、可选运行时校验与 JSON 响应封装。

## 用户接口

- 通过 `api(config, handler, validate?)` 或 `api(config, handler, { validate, responses, parameters })` 声明路由；`validate` 的类型为 `Validate<RequestParams<HandlerParams<T>>>`
- 通过 `middleware(handler, { responses, parameters }?)` 声明带文档元数据的 typed middleware
- 通过 `cors(options?)` 声明不携带 OpenAPI 元数据的 CORS middleware
- 通过 `routes(config, ...items)` 聚合路由并叠加 prefix / middlewares
- 通过 `Path<T, Meta>` 标记 path 参数
- 通过 `Query<T, Meta>` 标记 query 参数
- 通过 `Header<T, Meta>` 标记 header 参数
- 通过 `Cookie<T, Meta>` 标记 cookie 参数
- 通过 `Json<T, Meta>` 标记 JSON body 参数
- 通过 `Form<T, Meta>` 标记 form body 参数
- 通过 `inject(fn, options?)` 定义 request-scoped 依赖，在 handler 参数类型中使用 `Inject<typeof injectable>` 标注；编译时 transformer 自动从类型标注提取 inject 配置，运行时框架自动解析注入值并在请求结束后清理
- 通过在 `inject()` handler 参数类型中使用 `Path<T>` / `Query<T>` / `Header<T>` / `Cookie<T>` / `Json<T>` / `JsonResponse` 标注，编译时 transformer 自动提取参数与响应元数据并注入到 inject 配置中；运行时 inject 函数接收已解析的请求参数；`openapi()` 按 middleware < inject < route 优先级合并 inject 的参数与响应元数据
- 编译时 transformer 会直接从 handler 第一个参数类型提取 wrapper 元数据，并注入 `parameters`
- 编译时 transformer 会从 handler 参数类型中识别 `Inject<typeof X>` 模式，自动提取 injectable 变量引用并注入到 `api()` 的 `inject` 配置中
- 通过 `JsonResponse<Status, Headers, Body>` 标记 handler 返回类型
- 通过 `HtmlResponse` / `TextResponse` / `StreamResponse` / `SseResponse` 标记非 JSON 响应
- 通过 `createRouter(routes)` 生成标准 `(request: Request) => Promise<Response>` 处理函数
- 通过 `openapi({ info, routes, servers })` 从暴露路由生成 OpenAPI 3.1 文档
- `RouteConfig` 支持 OpenAPI operation 元数据：`tags` / `summary` / `description` / `operationId` / `deprecated` / `externalDocs`；`routes({ tags })` 会将组级 tags 与子路由 tags 合并去重，`openapi()` 会将这些字段输出到 operation object
- `RouteConfig` 支持声明式 `middlewares`
- 通过 `json()` / `html()` / `text()` / `stream()` / `sse()` / `redirect()` / `file()` 构造标准 `Response`，响应 helper 的 `headers` 支持单值与多值，并允许显式覆盖默认 `content-type`
- 通过 `cookie()` / `clearCookie()` 便捷序列化 `Set-Cookie` header 值
- 框架导出与 `typia` 返回结构兼容的 `Validate<T>` 类型；`api()` 的 `validate` 推荐在调用点使用 `typia.createValidate<RequestParams<ConcreteType>>()`，并通过 `RequestParams<T>` 剔除 `Inject<>` 字段避免校验运行时注入对象
- 框架导出 `RequestParams<T>` 工具类型，用于从 handler 参数类型中剔除带 `__inject` brand 的字段
- 可通过 `{ validate, responses, parameters }` 启用运行时校验并补充文档元数据；编译时 transformer 默认会直接从 handler 参数类型生成 OpenAPI 参数元数据，并从 `JsonResponse` 返回类型生成响应元数据；调用点显式提供 `parameters` / `responses` 时不覆盖
- 编译时 transformer 同样会从 `middleware()` handler 返回的 inner handler 参数类型提取 wrapper 元数据并注入 `parameters`，并从 inner handler 返回类型中的 `JsonResponse` brand 提取 `responses`；`openapi()` 会按 middleware 声明顺序收集其 `__entries` / `__body` / `__responses`，再与 route 自身元数据合并，且 route 对同名同位置参数、requestBody 与同状态码 responses 拥有更高优先级
- 通过 `HttpError(status, body?, headers?)` 在 handler 或 middleware 中抛出受控的 HTTP 错误响应
- `createRouter` 默认将 `HttpError` 转为对应响应，其他异常转为 `500 Internal Server Error`
- `routes()` 支持 `onError` 选项自定义错误处理，不同路由组可以有不同的错误处理逻辑
- 框架导出 `handleError` 作为默认错误处理函数，供自定义 `onError` 中作为 fallback 使用
- 通过 `redirect(url, status?)` 构造重定向响应，handler 返回 `URL` 对象时自动转换为 `307` 重定向
- 通过 `file(path, options?)` 构造静态文件响应，自动推断 MIME type，跨运行时兼容
- 通过 `requestSymbol` 和 `RequestContext` 在 handler 中访问原始 `Request` 对象

## 本次范围

- 支持 `method + path` 路由匹配
- 支持路径参数，如 `/users/:id`
- 自动提取 path、query、header、cookie、JSON body、form body 并合并为 `params`
- 参数合并优先级为 `path > body > query > cookie > header`
- 提供可选的运行时参数校验，校验失败返回 `400`
- 支持 route 级与 route-group 级 middleware，执行顺序为外层到内层再到 handler
- 命中 route 后的执行顺序为 `middleware 外层 → validate → inject → handler → middleware 内层`，`validate` 失败直接返回 `400` 且不会触发 `inject`
- 支持可配置的 CORS middleware，处理普通请求与 preflight 请求头写入
- handler 返回值自动转换为响应：`Response` 透传，`null` 转为 `204`，`string` 转为文本响应，`ReadableStream` 转为二进制流响应，`AsyncIterable` 转为 SSE，其余值转为 JSON 响应
- `JsonResponse` 使用字符串键 `__response` 暴露状态码与响应头元数据，便于 schema 生成工具读取
- query 与 path 参数按 JSON 标量规则尝试解析，无法解析时保持字符串
- `route.handle(request)` 与 `route.match(request)` 使用一致的 `method + path` 命中规则
- 命中路由时可复用单次解析出的 URL，避免在匹配与参数提取阶段重复解析
- JSON body 仅接受对象，数组与原始值视为无效请求
- `routes()` 支持 prefix 叠加与 middleware 叠加，且不修改原始 route
- SSE 支持直接传入 `ReadableStream`，也支持由 `AsyncIterable` 自动转换
- 非法 percent-encoding 的 path 视为未命中，不应抛出运行时异常
- `openapi()` 仅收集 `expose: true` 的路由；参数文档优先读取 transformer 直接注入的 `__entries` / `__body` 字面量，字段元数据来自 wrapper 类型第二个泛型参数 `Meta` 中的 `title/description/alias/example/deprecated`，并兼容旧的 typia `ParamsSchema<T>` 输出作为回退；响应文档优先读取 transformer 直接注入的 `__responses` 字面量，并继续兼容手动传入的 `typia.json.schemas()` 输出
- `api()` 的 handler 泛型约束需兼容 TypeScript `strictFunctionTypes`，允许传入参数类型比默认 `RouteHandler<unknown, unknown>` 更具体的函数签名
- 支持基于 `Promise` 或 `AsyncGenerator` 的 request-scoped 注入；同一次解析内默认按 Injectable 实例缓存，并在 cleanup 时逆序推进 generator 完成资源释放
- `inject()` handler 支持 `Path` / `Query` / `Header` / `Cookie` / `Json` 参数类型标注与 `JsonResponse` 响应类型标注，编译时 transformer 自动提取元数据，运行时注入已解析的请求参数，`openapi()` 自动合并 inject 元数据
- handler 和 middleware 中抛出的 `HttpError(status, body?, headers?)` 会被自动捕获并转换为对应状态码的响应；`body` 为字符串时响应体为 `{ message }` JSON，为对象时原样输出，省略时无响应体
- handler 和 middleware 中抛出的其他异常会被捕获并返回 `500 Internal Server Error`，不暴露内部错误信息
- `routes()` 支持 `onError(error, request)` 选项，在路由组级别自定义错误处理；未配置 `onError` 的路由组由 `createRouter` 默认兜底
- Injectable 的清理逻辑在错误发生时仍然执行
- handler 返回 `URL` 对象时自动转换为 `307` 重定向响应
- `redirect(url, status?)` 支持 string 和 URL 参数，默认状态码 `302`
- `file(path, options?)` 支持自动 MIME type 推断，兼容 Bun 和 Node.js 运行时
- `json()` / `html()` / `text()` / `stream()` / `sse()` / `file()` 的 `headers` 支持 `string` 与 `string[]`，同名 header 会按追加语义写入；仅在调用方未设置时才补默认 `content-type`
- `extractParams` 注入 `requestSymbol` 到 params 中，handler 可通过 `params[requestSymbol]` 访问原始 `Request`
- form body（`application/x-www-form-urlencoded` 和 `multipart/form-data`）自动解析，字符串字段尝试 `parseScalar`，`File` 保持原对象，重复 key 聚合为数组
- `cookie(name, value, options?)` 使用 `encodeURIComponent` 编码 name / value 并序列化 `Domain`、`Path`、`Max-Age`、`Expires`、`HttpOnly`、`SameSite`、`Secure`、`Partitioned`；`sameSite: "None"` 时自动附加 `Secure`
- `clearCookie(name, options?)` 基于 `cookie()` 生成删除 cookie 的 `Set-Cookie` 值，固定写入 `Max-Age=0` 与 `Expires=Thu, 01 Jan 1970 00:00:00 GMT`

## 实现约束

- 项目使用 ESM 与 TypeScript `NodeNext`
- 包需要可直接发布到 npm，`typia` 和 `ts-patch` 是 required peer dependency，任何使用 `api()` 进行运行时参数校验的文件都必须手写 `typia.createValidate<RequestParams<HandlerParamType>>()`
- 自定义 transformer（`transform.cjs`）必须在 `typia/lib/transform` 之前运行，并直接使用 TypeScript type checker 生成参数元数据字面量
- 由于 `typia` transformer 无法在框架内部解析泛型参数，validator 必须在 `api()` 调用点基于具体类型创建并传入
- Router 需按 HTTP method 建立索引，并优先以 O(1) 方式命中静态 path，再回退到动态 path 扫描

## 暂不包含
