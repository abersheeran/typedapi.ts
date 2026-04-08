import { describe, it, expect } from "vitest";
import { api, routeResponsesSymbol } from "../src/api.js";
import { requestSymbol } from "../src/context.js";
import { createRouter } from "../src/router.js";

function req(method: string, url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, { method, ...options });
}

function jsonReq(method: string, url: string, body: unknown) {
  return req(method, url, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Path 参数 ──

describe("path params", () => {
  const route = api(
    { method: "GET", path: "/users/:id" },
    async (p: { id: unknown }) => ({ id: p.id }),
  );
  const rootParamRoute = api(
    { method: "GET", path: "/:id" },
    async (p: { id: unknown }) => ({ id: p.id }),
  );

  it("extracts numeric path param", async () => {
    const res = await route.handle(req("GET", "/users/42"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 42 });
  });

  it("extracts string path param", async () => {
    const res = await route.handle(req("GET", "/users/abc"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "abc" });
  });

  it("extracts boolean path param", async () => {
    const res = await rootParamRoute.handle(req("GET", "/true"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: true });
  });

  it("extracts null path param", async () => {
    const res = await rootParamRoute.handle(req("GET", "/null"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: null });
  });

  it("extracts float path param", async () => {
    const res = await rootParamRoute.handle(req("GET", "/3.14"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 3.14 });
  });

  it("extracts negative number path param", async () => {
    const res = await rootParamRoute.handle(req("GET", "/-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: -1 });
  });

  it("decodes URI-encoded path param", async () => {
    const res = await route.handle(req("GET", "/users/hello%20world"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "hello world" });
  });

  it("multi-segment path params", async () => {
    const route2 = api(
      { method: "GET", path: "/accounts/:accountId/invoices/:invoiceId" },
      async (p: { accountId: unknown; invoiceId: unknown }) => ({
        accountId: p.accountId,
        invoiceId: p.invoiceId,
      }),
    );
    const res = await route2.handle(req("GET", "/accounts/7/invoices/INV-001"));
    expect(await res.json()).toEqual({ accountId: 7, invoiceId: "INV-001" });
  });
});

describe("path matching", () => {
  const route = api(
    { method: "GET", path: "/users/:id" },
    async () => ({}),
  );

  it("match returns RouteMatch on hit", () => {
    const match = route.match(req("GET", "/users/1"));
    expect(match?.params).toEqual({ id: 1 });
    expect(match?.url).toBeInstanceOf(URL);
  });

  it("match reuses provided URL", () => {
    const request = req("GET", "/users/1?from=query");
    const url = new URL(request.url);
    const match = route.match(request, url);
    expect(match?.params).toEqual({ id: 1 });
    expect(match?.url).toBe(url);
  });

  it("match returns null on wrong method", () => {
    expect(route.match(req("POST", "/users/1"))).toBeNull();
  });

  it("match returns null on wrong path", () => {
    expect(route.match(req("GET", "/posts/1"))).toBeNull();
  });

  it("match returns null on extra segments", () => {
    expect(route.match(req("GET", "/users/1/extra"))).toBeNull();
  });

  it("match returns null on fewer segments", () => {
    expect(route.match(req("GET", "/users"))).toBeNull();
  });

  it("match returns null for invalid URI encoding", () => {
    expect(route.match(req("GET", "/users/%ZZ"))).toBeNull();
  });

  it("dynamic routes still match trailing slash", () => {
    expect(route.match(req("GET", "/users/5/"))?.params).toEqual({ id: 5 });
  });

  it("method matching is case-insensitive", () => {
    expect(route.match(req("get", "/users/1"))).not.toBeNull();
  });
});

describe("root path", () => {
  const route = api({ method: "GET", path: "/" }, async () => ({ root: true }));

  it("matches root path /", async () => {
    const res = await route.handle(req("GET", "/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root: true });
  });

  it("match returns non-null for /", () => {
    expect(route.match(req("GET", "/"))).not.toBeNull();
  });
});

// ── Query 参数 ──

describe("query params", () => {
  const route = api(
    { method: "GET", path: "/search" },
    async (p: { q: unknown; page: unknown }) => ({ q: p.q, page: p.page }),
  );

  it("extracts string query param", async () => {
    const res = await route.handle(req("GET", "/search?q=hello&page=2"));
    expect(await res.json()).toEqual({ q: "hello", page: 2 });
  });

  it("extracts repeated query params as array", async () => {
    const route2 = api(
      { method: "GET", path: "/filter" },
      async (p: { tags: unknown }) => ({ tags: p.tags }),
    );
    const res = await route2.handle(req("GET", "/filter?tags=a&tags=b&tags=c"));
    expect(await res.json()).toEqual({ tags: ["a", "b", "c"] });
  });

  it("handles missing query params as undefined", async () => {
    const res = await route.handle(req("GET", "/search"));
    const body = await res.json();
    expect(body.q).toBeUndefined();
  });

  it("extracts boolean query param", async () => {
    const route2 = api(
      { method: "GET", path: "/flags" },
      async (p: { active: unknown }) => ({ active: p.active }),
    );
    const res = await route2.handle(req("GET", "/flags?active=true"));
    expect(await res.json()).toEqual({ active: true });
  });

  it("extracts null query param", async () => {
    const route2 = api(
      { method: "GET", path: "/nullable" },
      async (p: { x: unknown }) => ({ x: p.x }),
    );
    const res = await route2.handle(req("GET", "/nullable?x=null"));
    expect(await res.json()).toEqual({ x: null });
  });

  it("extracts float query param", async () => {
    const route2 = api(
      { method: "GET", path: "/numbers" },
      async (p: { n: unknown }) => ({ n: p.n }),
    );
    const res = await route2.handle(req("GET", "/numbers?n=3.14"));
    expect(await res.json()).toEqual({ n: 3.14 });
  });

  it("decodes plus signs in query params as spaces", async () => {
    const route2 = api(
      { method: "GET", path: "/strings" },
      async (p: { s: unknown }) => ({ s: p.s }),
    );
    const res = await route2.handle(req("GET", "/strings?s=hello+world"));
    expect(await res.json()).toEqual({ s: "hello world" });
  });
});

// ── JSON body ──

describe("json body", () => {
  const route = api(
    { method: "POST", path: "/items" },
    async (p: { name: unknown; price: unknown }) => ({
      name: p.name,
      price: p.price,
    }),
  );

  it("extracts JSON body fields", async () => {
    const res = await route.handle(
      jsonReq("POST", "/items", { name: "Widget", price: 9.99 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Widget", price: 9.99 });
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await route.handle(
      req("POST", "/items", {
        headers: { "content-type": "application/json" },
        body: "{bad json",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/Invalid JSON/i);
  });

  it("returns 400 for JSON array body", async () => {
    const res = await route.handle(
      jsonReq("POST", "/items", [1, 2, 3]),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/object/i);
  });

  it("returns 400 for JSON null body", async () => {
    const res = await route.handle(jsonReq("POST", "/items", null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "JSON body must be an object",
    });
  });

  it("returns 400 for JSON boolean body", async () => {
    const res = await route.handle(jsonReq("POST", "/items", true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "JSON body must be an object",
    });
  });

  it("returns 400 for JSON number body", async () => {
    const res = await route.handle(jsonReq("POST", "/items", 42));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "JSON body must be an object",
    });
  });

  it("skips body parsing when content-type is not JSON", async () => {
    const res = await route.handle(
      req("POST", "/items", {
        headers: { "content-type": "text/plain" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("handles empty JSON body gracefully", async () => {
    const res = await route.handle(
      req("POST", "/items", {
        headers: { "content-type": "application/json" },
        body: "",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("parses JSON body with charset content-type", async () => {
    const res = await route.handle(
      req("POST", "/items", {
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ name: "Widget", price: 9.99 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Widget", price: 9.99 });
  });

  it("treats whitespace-only JSON body as empty", async () => {
    const res = await route.handle(
      req("POST", "/items", {
        headers: { "content-type": "application/json" },
        body: "   ",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});

describe("form body", () => {
  it("extracts application/x-www-form-urlencoded fields", async () => {
    const route = api(
      { method: "POST", path: "/form-urlencoded" },
      async (p: { name: unknown; active: unknown }) => ({
        name: p.name,
        active: p.active,
      }),
    );

    const res = await route.handle(
      req("POST", "/form-urlencoded", {
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          name: "Alice",
          active: "true",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Alice",
      active: true,
    });
  });

  it("extracts multipart/form-data text fields", async () => {
    const form = new FormData();
    form.set("title", "Hello");
    form.set("count", "2");

    const route = api(
      { method: "POST", path: "/form-multipart" },
      async (p: { title: unknown; count: unknown }) => ({
        title: p.title,
        count: p.count,
      }),
    );

    const res = await route.handle(
      req("POST", "/form-multipart", {
        body: form,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      title: "Hello",
      count: 2,
    });
  });

  it("passes multipart file fields as File objects", async () => {
    const form = new FormData();
    form.set("file", new File(["hello world"], "hello.txt", { type: "text/plain" }));

    const route = api(
      { method: "POST", path: "/form-file" },
      async (p: { file: unknown }) => {
        const file = p.file as File;
        return {
          isFile: file instanceof File,
          name: file.name,
          type: file.type,
          text: await file.text(),
        };
      },
    );

    const res = await route.handle(
      req("POST", "/form-file", {
        body: form,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isFile: true,
      name: "hello.txt",
      type: "text/plain",
      text: "hello world",
    });
  });

  it("merges repeated form fields into arrays", async () => {
    const form = new FormData();
    form.append("tags", "a");
    form.append("tags", "b");
    form.append("tags", "c");

    const route = api(
      { method: "POST", path: "/form-repeat" },
      async (p: { tags: unknown }) => ({ tags: p.tags }),
    );

    const res = await route.handle(
      req("POST", "/form-repeat", {
        body: form,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tags: ["a", "b", "c"],
    });
  });
});

// ── Header 参数 ──

describe("header params", () => {
  const route = api(
    { method: "GET", path: "/me" },
    async (p: { authorization: unknown; "x-trace-id": unknown }) => ({
      auth: p.authorization,
      trace: p["x-trace-id"],
    }),
  );

  it("extracts headers as lowercase keys", async () => {
    const res = await route.handle(
      req("GET", "/me", {
        headers: {
          Authorization: "Bearer tok123",
          "X-Trace-Id": "trace-abc",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      auth: "Bearer tok123",
      trace: "trace-abc",
    });
  });
});

// ── Cookie 参数 ──

describe("cookie params", () => {
  const route = api(
    { method: "GET", path: "/cart" },
    async (p: { session: unknown; locale: unknown }) => ({
      session: p.session,
      locale: p.locale,
    }),
  );

  it("extracts cookies from Cookie header", async () => {
    const res = await route.handle(
      req("GET", "/cart", {
        headers: { cookie: "session=abc123; locale=zh-CN" },
      }),
    );
    expect(await res.json()).toEqual({
      session: "abc123",
      locale: "zh-CN",
    });
  });

  it("handles missing cookie header", async () => {
    const res = await route.handle(req("GET", "/cart"));
    const body = await res.json();
    expect(body.session).toBeUndefined();
  });

  it("handles cookie with empty value", async () => {
    const res = await route.handle(
      req("GET", "/cart", {
        headers: { cookie: "session=; locale=en" },
      }),
    );
    const body = await res.json();
    expect(body.session).toBe("");
    expect(body.locale).toBe("en");
  });

  it("skips malformed cookie entries without affecting valid cookies", async () => {
    const res = await route.handle(
      req("GET", "/cart", {
        headers: { cookie: "bad; session=abc" },
      }),
    );
    expect(await res.json()).toEqual({ session: "abc" });
  });

  it("preserves cookie values containing equals signs", async () => {
    const route2 = api(
      { method: "GET", path: "/token" },
      async (p: { token: unknown }) => ({ token: p.token }),
    );
    const res = await route2.handle(
      req("GET", "/token", {
        headers: { cookie: "token=a=b=c" },
      }),
    );
    expect(await res.json()).toEqual({ token: "a=b=c" });
  });

  it("parses cookie edge cases: empty value, name-only, value containing equals", async () => {
    const route2 = api(
      { method: "GET", path: "/c" },
      async (params: { a?: unknown; b?: unknown; c?: unknown; d?: unknown }) => ({
        a: params.a,
        b: params.b,
        c: params.c,
        d: params.d,
      }),
    );

    const app = createRouter([route2]);
    const res = await app(
      new Request("http://x/c", {
        headers: {
          cookie: "a=; b; c=x=y=z; d=ok",
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.d).toBe("ok");
  });
});

// ── 参数合并优先级 ──

describe("param merge priority (path > body > query > cookie > header)", () => {
  const route = api(
    { method: "POST", path: "/test/:name" },
    async (p: { name: unknown }) => ({ name: p.name }),
  );

  it("path overrides body", async () => {
    const res = await route.handle(
      jsonReq("POST", "/test/from-path", { name: "from-body" }),
    );
    expect(await res.json()).toEqual({ name: "from-path" });
  });

  it("body overrides query", async () => {
    const route2 = api(
      { method: "POST", path: "/test" },
      async (p: { name: unknown }) => ({ name: p.name }),
    );
    const res = await route2.handle(
      new Request("http://localhost/test?name=from-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "from-body" }),
      }),
    );
    expect(await res.json()).toEqual({ name: "from-body" });
  });

  it("query overrides cookie", async () => {
    const route2 = api(
      { method: "GET", path: "/test" },
      async (p: { token: unknown }) => ({ token: p.token }),
    );
    const res = await route2.handle(
      req("GET", "/test?token=from-query", {
        headers: { cookie: "token=from-cookie" },
      }),
    );
    expect(await res.json()).toEqual({ token: "from-query" });
  });

  it("resolves parameter priority as path > body > query > cookie > header for same name", async () => {
    const route2 = api(
      { method: "POST", path: "/p/:item" },
      async (params: { item: unknown }) => ({ from: params.item }),
    );

    const app = createRouter([route2]);

    const res = await app(
      new Request("http://x/p/from-path?item=from-query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "item=from-cookie",
          item: "from-header",
        },
        body: JSON.stringify({ item: "from-body" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: "from-path" });
  });
});

// ── Response passthrough ──

describe("response passthrough", () => {
  it("returns Response directly when handler returns Response", async () => {
    const route = api(
      { method: "GET", path: "/raw" },
      async () => new Response("raw body", { status: 201 }),
    );
    const res = await route.handle(req("GET", "/raw"));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("raw body");
  });
});

describe("handle() without match", () => {
  it("returns 404 when called with wrong method", async () => {
    const route = api({ method: "GET", path: "/x" }, async () => ({}));
    const res = await route.handle(req("POST", "/x"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when called with wrong path", async () => {
    const route = api({ method: "GET", path: "/x" }, async () => ({}));
    const res = await route.handle(req("GET", "/y"));
    expect(res.status).toBe(404);
  });
});

describe("handler return values", () => {
  it("returns null as 204 no content", async () => {
    const route = api({ method: "GET", path: "/null" }, async () => null);
    const res = await route.handle(req("GET", "/null"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("returns string as text response", async () => {
    const route = api({ method: "GET", path: "/text" }, async () => "hello world");
    const res = await route.handle(req("GET", "/text"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("hello world");
  });

  it("returns ReadableStream as octet-stream response", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk-1"));
        controller.close();
      },
    });
    const route = api({ method: "GET", path: "/stream" }, async () => body);
    const res = await route.handle(req("GET", "/stream"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(await res.text()).toBe("chunk-1");
  });

  it("converts bare ReadableStream handler return to octet-stream response", async () => {
    const route = api(
      { method: "GET", path: "/raw" },
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello"));
            controller.close();
          },
        }),
    );

    const app = createRouter([route]);
    const res = await app(new Request("http://x/raw"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/octet-stream");
    expect(await res.text()).toBe("hello");
  });

  it("returns AsyncIterable as sse response", async () => {
    const route = api({ method: "GET", path: "/events" }, async function* () {
      yield { type: "ping" };
      yield { type: "data", payload: 42 };
    });
    const res = await route.handle(req("GET", "/events"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe(
      'data: {"type":"ping"}\n\ndata: {"type":"data","payload":42}\n\n',
    );
  });

  it("returns undefined as JSON null", async () => {
    const route = api({ method: "GET", path: "/undefined" }, async () => undefined);
    const res = await route.handle(req("GET", "/undefined"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("null");
  });

  it("returns array as JSON array", async () => {
    const route = api({ method: "GET", path: "/array" }, async () => [1, 2, 3]);
    const res = await route.handle(req("GET", "/array"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([1, 2, 3]);
  });

  it("returns number as JSON number", async () => {
    const route = api({ method: "GET", path: "/number" }, async () => 42);
    const res = await route.handle(req("GET", "/number"));
    expect(res.status).toBe(200);
    expect(await res.json()).toBe(42);
  });

  it("returns URL as redirect response", async () => {
    const route = api(
      { method: "GET", path: "/docs" },
      async () => new URL("https://example.com/docs"),
    );
    const res = await route.handle(req("GET", "/docs"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.com/docs");
  });
});

describe("request context", () => {
  it("exposes request url and method via requestSymbol", async () => {
    const route = api(
      { method: "POST", path: "/context" },
      async (p: { [requestSymbol]: Request }) => {
        const request = p[requestSymbol];
        return {
          url: request.url,
          method: request.method,
        };
      },
    );

    const res = await route.handle(req("POST", "/context?from=test"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "http://localhost/context?from=test",
      method: "POST",
    });
  });
});

// ── Validation ──

describe("validation", () => {
  const validate = (input: unknown) => {
    const data = input as Record<string, unknown>;
    if (typeof data.name !== "string" || typeof data.age !== "number") {
      return {
        success: false,
        data: data as { name: string; age: number },
        errors: [{ path: "", message: "invalid" }],
      };
    }
    return {
      success: true,
      data: data as { name: string; age: number },
      errors: [],
    };
  };

  const route = api(
    { method: "POST", path: "/validated" },
    async (p: { name: string; age: number }) => ({
      name: p.name,
      age: p.age,
    }),
    validate,
  );

  it("passes validation with correct data", async () => {
    const res = await route.handle(
      jsonReq("POST", "/validated", { name: "Alice", age: 30 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Alice", age: 30 });
  });

  it("returns 400 when validation fails", async () => {
    const res = await route.handle(
      jsonReq("POST", "/validated", { name: 123, age: "not a number" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/Invalid/i);
    expect(body.errors).toBeDefined();
  });

  it("supports options object with validate", async () => {
    const route = api(
      { method: "POST", path: "/validated-options" },
      async (p: { name: string; age: number }) => ({
        name: p.name,
        age: p.age,
      }),
      { validate },
    );

    const res = await route.handle(
      jsonReq("POST", "/validated-options", { name: "Alice", age: 30 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Alice", age: 30 });
  });

  it("stores responses metadata on the route", () => {
    const responses = { 200: { description: "ok" } };
    const route = api(
      { method: "GET", path: "/responses" },
      async () => ({ ok: true }),
      { responses },
    );

    expect((route as Record<symbol, unknown>)[routeResponsesSymbol]).toBe(
      responses,
    );
  });
});
