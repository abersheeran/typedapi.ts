import { describe, it, expect, test } from "vitest";
import {
  api,
  routeParametersSymbol,
  routeResponsesSymbol,
} from "../src/api.js";
import { routes } from "../src/routes.js";
import { createRouter } from "../src/router.js";

function req(method: string, url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, { method, ...options });
}

// ── 基础 routes 聚合 ──

describe("routes basic grouping", () => {
  it("groups multiple routes without options", () => {
    const r1 = api({ method: "GET", path: "/a" }, async () => ({ a: 1 }));
    const r2 = api({ method: "GET", path: "/b" }, async () => ({ b: 2 }));

    const grouped = routes({}, r1, r2);
    expect(grouped).toHaveLength(2);
  });

  it("grouped routes work with createRouter", async () => {
    const r1 = api({ method: "GET", path: "/a" }, async () => ({ a: 1 }));
    const r2 = api({ method: "GET", path: "/b" }, async () => ({ b: 2 }));

    const app = createRouter(routes({}, r1, r2));
    const res = await app(req("GET", "/a"));
    expect(await res.json()).toEqual({ a: 1 });
  });
});

// ── prefix ──

describe("routes with prefix", () => {
  it("prepends prefix to all routes", async () => {
    const getUsers = api(
      { method: "GET", path: "/users" },
      async () => [{ id: 1 }],
    );
    const getItems = api(
      { method: "GET", path: "/items" },
      async () => [{ id: 2 }],
    );

    const app = createRouter(
      routes({ prefix: "/api" }, getUsers, getItems),
    );

    const res1 = await app(req("GET", "/api/users"));
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual([{ id: 1 }]);

    const res2 = await app(req("GET", "/api/items"));
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual([{ id: 2 }]);

    // Original paths should 404
    const res3 = await app(req("GET", "/users"));
    expect(res3.status).toBe(404);
  });

  it("prefix works with path params", async () => {
    const getUser = api(
      { method: "GET", path: "/users/:id" },
      async (p: { id: unknown }) => ({ id: p.id }),
    );

    const app = createRouter(routes({ prefix: "/api/v1" }, getUser));
    const res = await app(req("GET", "/api/v1/users/42"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 42 });
  });

  it("treats empty prefix the same as no prefix", async () => {
    const getUsers = api(
      { method: "GET", path: "/users" },
      async () => [{ id: 1 }],
    );

    const app = createRouter(routes({ prefix: "" }, getUsers));
    const res = await app(req("GET", "/users"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it("handles prefixes with trailing slashes without duplicating separators", async () => {
    const getUsers = api(
      { method: "GET", path: "/users" },
      async () => [{ id: 1 }],
    );

    const app = createRouter(routes({ prefix: "/api/" }, getUsers));
    const res = await app(req("GET", "/api/users"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);

    const miss = await app(req("GET", "/api//users"));
    expect(miss.status).toBe(404);
  });
});

describe("routes validation passthrough", () => {
  it("validation is preserved when wrapped by routes()", async () => {
    const validate = (input: unknown) => {
      const data = input as Record<string, unknown>;
      if (typeof data.n !== "number") {
        return {
          success: false,
          data: data as { n: number },
          errors: [{ path: "n", message: "n must be a number" }],
        };
      }
      return {
        success: true,
        data: data as { n: number },
        errors: [],
      };
    };

    const r = api(
      { method: "POST", path: "/x" },
      async (p: { n: number }) => p,
      validate,
    );
    const app = createRouter(routes({ prefix: "/api" }, r));

    const valid = await app(
      req("POST", "/api/x", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: 1 }),
      }),
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ n: 1 });

    const invalid = await app(
      req("POST", "/api/x", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: "bad" }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      message: "Invalid request",
      errors: [{ path: "n", message: "n must be a number" }],
    });
  });

  it("responses metadata is preserved when wrapped by routes()", () => {
    const responses = { 200: { description: "ok" } };
    const [wrapped] = routes(
      { prefix: "/api" },
      api(
        { method: "GET", path: "/x" },
        async () => ({ ok: true }),
        { responses },
      ),
    );

    expect((wrapped as Record<symbol, unknown>)[routeResponsesSymbol]).toBe(
      responses,
    );
  });

  it("parameters metadata is preserved when wrapped by routes()", () => {
    const parameters = { __entries: [], __body: null };
    const [wrapped] = routes(
      { prefix: "/api" },
      api(
        { method: "GET", path: "/x" },
        async () => ({ ok: true }),
        { parameters },
      ),
    );

    expect((wrapped as Record<symbol, unknown>)[routeParametersSymbol]).toBe(
      parameters,
    );
  });

  it("validate still runs end-to-end when wrapped by routes()", async () => {
    const validate = (input: unknown) => {
      const n = (input as { n?: unknown })?.n;
      if (typeof n === "number") {
        return { success: true, data: { n } } as const;
      }
      return {
        success: false,
        errors: [{ path: "n", expected: "number", value: n }],
      } as const;
    };

    const [wrapped] = routes(
      { prefix: "/api" },
      api(
        { method: "POST", path: "/x" },
        async (params: { n: number }) => ({ n: params.n }),
        { validate: validate as any },
      ),
    );

    const app = createRouter([wrapped]);

    const valid = await app(
      new Request("http://x/api/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: 7 }),
      }),
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ n: 7 });

    const invalid = await app(
      new Request("http://x/api/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: "nope" }),
      }),
    );
    expect(invalid.status).toBe(400);
  });
});

// ── 嵌套 routes ──

describe("nested routes", () => {
  it("nests route groups with stacked prefixes", async () => {
    const getUser = api(
      { method: "GET", path: "/users/:id" },
      async (p: { id: unknown }) => ({ id: p.id }),
    );

    const inner = routes({ prefix: "/v1" }, getUser);
    const outer = routes({ prefix: "/api" }, ...inner);

    const app = createRouter(outer);
    const res = await app(req("GET", "/api/v1/users/5"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 5 });
  });

  it("supports mixing single routes and route groups", async () => {
    const health = api(
      { method: "GET", path: "/health" },
      async () => ({ status: "ok" }),
    );
    const getUser = api(
      { method: "GET", path: "/users/:id" },
      async (p: { id: unknown }) => ({ id: p.id }),
    );

    const apiRoutes = routes({ prefix: "/api" }, getUser);
    const app = createRouter([health, ...apiRoutes]);

    const res1 = await app(req("GET", "/health"));
    expect(res1.status).toBe(200);

    const res2 = await app(req("GET", "/api/users/1"));
    expect(res2.status).toBe(200);
  });
});

// ── routes 级别的 middleware ──

describe("routes with middlewares", () => {
  it("applies middleware to all routes in group", async () => {
    const calls: string[] = [];

    const logger = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        calls.push("logger");
        return next();
      };

    const r1 = api({ method: "GET", path: "/a" }, async () => {
      calls.push("handler-a");
      return { a: 1 };
    });
    const r2 = api({ method: "GET", path: "/b" }, async () => {
      calls.push("handler-b");
      return { b: 2 };
    });

    const app = createRouter(
      routes({ prefix: "/api", middlewares: [logger] }, r1, r2),
    );

    await app(req("GET", "/api/a"));
    expect(calls).toEqual(["logger", "handler-a"]);

    calls.length = 0;
    await app(req("GET", "/api/b"));
    expect(calls).toEqual(["logger", "handler-b"]);
  });

  it("routes middleware runs before route-level middleware", async () => {
    const order: string[] = [];

    const outerMw = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("outer");
        return next();
      };

    const innerMw = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("inner");
        return next();
      };

    const route = api(
      { method: "GET", path: "/test", middlewares: [innerMw] },
      async () => {
        order.push("handler");
        return {};
      },
    );

    const app = createRouter(
      routes({ middlewares: [outerMw] }, route),
    );

    await app(req("GET", "/test"));
    expect(order).toEqual(["outer", "inner", "handler"]);
  });

  it("routes middleware can short-circuit all routes", async () => {
    const block = (_next: () => Promise<Response>) =>
      async (_params: {}) =>
        new Response("Forbidden", { status: 403 });

    const r1 = api({ method: "GET", path: "/a" }, async () => ({ a: 1 }));
    const r2 = api({ method: "GET", path: "/b" }, async () => ({ b: 2 }));

    const app = createRouter(
      routes({ prefix: "/api", middlewares: [block] }, r1, r2),
    );

    const res1 = await app(req("GET", "/api/a"));
    expect(res1.status).toBe(403);

    const res2 = await app(req("GET", "/api/b"));
    expect(res2.status).toBe(403);
  });

  it("routes middleware can access request params", async () => {
    let capturedKey: unknown;

    const apiKeyCheck = (next: () => Promise<Response>) =>
      async (params: { "x-api-key": unknown }) => {
        capturedKey = params["x-api-key"];
        if (!params["x-api-key"]) {
          return new Response("Unauthorized", { status: 401 });
        }
        return next();
      };

    const r = api(
      { method: "GET", path: "/data" },
      async () => ({ data: 42 }),
    );

    const app = createRouter(
      routes({ prefix: "/api", middlewares: [apiKeyCheck] }, r),
    );

    // Without API key
    const res1 = await app(req("GET", "/api/data"));
    expect(res1.status).toBe(401);

    // With API key
    const res2 = await app(
      req("GET", "/api/data", {
        headers: { "X-Api-Key": "secret" },
      }),
    );
    expect(res2.status).toBe(200);
    expect(capturedKey).toBe("secret");
  });
});

// ── 嵌套 routes 的 middleware 堆叠 ──

describe("nested routes middleware stacking", () => {
  it("outer group middleware runs before inner group middleware", async () => {
    const order: string[] = [];

    const mw1 = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("mw1");
        return next();
      };

    const mw2 = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("mw2");
        return next();
      };

    const route = api({ method: "GET", path: "/test" }, async () => {
      order.push("handler");
      return {};
    });

    const inner = routes({ middlewares: [mw2] }, route);
    const outer = routes({ prefix: "/api", middlewares: [mw1] }, ...inner);

    const app = createRouter(outer);
    await app(req("GET", "/api/test"));
    expect(order).toEqual(["mw1", "mw2", "handler"]);
  });
});

test("routes() merges group tags and omits tags when neither group nor child defines them", () => {
  const [merged] = routes(
    { tags: ["v1", "users"] },
    api(
      { method: "GET", path: "/users", tags: ["users", "detail"] },
      async () => ({ ok: true }),
    ),
  );
  const [plain] = routes(
    {},
    api({ method: "GET", path: "/health" }, async () => ({ ok: true })),
  );

  expect(merged.config.tags).toEqual(["v1", "users", "detail"]);
  expect(plain.config).not.toHaveProperty("tags");
});

// ── createRouter 接受嵌套数组 ──

describe("createRouter with nested arrays", () => {
  it("accepts flat Route array", async () => {
    const r = api({ method: "GET", path: "/a" }, async () => ({ a: 1 }));
    const app = createRouter([r]);
    const res = await app(req("GET", "/a"));
    expect(res.status).toBe(200);
  });

  it("accepts mixed Route and Route[]", async () => {
    const r1 = api({ method: "GET", path: "/a" }, async () => ({ a: 1 }));
    const group = routes(
      { prefix: "/api" },
      api({ method: "GET", path: "/b" }, async () => ({ b: 2 })),
    );

    const app = createRouter([r1, ...group]);
    const res1 = await app(req("GET", "/a"));
    expect(res1.status).toBe(200);

    const res2 = await app(req("GET", "/api/b"));
    expect(res2.status).toBe(200);
  });
});
