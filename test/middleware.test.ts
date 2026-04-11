import { describe, it, expect } from "vitest";
import { api } from "../src/api.js";
import { inject } from "../src/inject.js";
import {
  middleware,
  middlewareInjectSymbol,
  middlewareValidateSymbol,
} from "../src/middleware.js";
import { routes } from "../src/routes.js";
import type { Validate } from "../src/types.js";

function req(method: string, url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, { method, ...options });
}

function jsonReq(method: string, url: string, body: unknown) {
  return req(method, url, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── 基础中间件 ──

describe("middleware basics", () => {
  it("passthrough middleware calls next and returns response", async () => {
    const passthrough = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        return next();
      };

    const route = api(
      { method: "GET", path: "/test", middlewares: [passthrough] },
      async () => ({ ok: true }),
    );

    const res = await route.handle(req("GET", "/test"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("middleware can short-circuit and return early", async () => {
    const block = (_next: () => Promise<Response>) =>
      async (_params: {}) => {
        return new Response(JSON.stringify({ error: "blocked" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      };

    const route = api(
      { method: "GET", path: "/test", middlewares: [block] },
      async () => ({ ok: true }),
    );

    const res = await route.handle(req("GET", "/test"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "blocked" });
  });

  it("middleware can read params from request", async () => {
    const auth = (next: () => Promise<Response>) =>
      async (params: { authorization: unknown }) => {
        if (!params.authorization) {
          return new Response("Unauthorized", { status: 401 });
        }
        return next();
      };

    const route = api(
      { method: "GET", path: "/me", middlewares: [auth] },
      async () => ({ user: "alice" }),
    );

    // Without auth header
    const res1 = await route.handle(req("GET", "/me"));
    expect(res1.status).toBe(401);

    // With auth header
    const res2 = await route.handle(
      req("GET", "/me", {
        headers: { Authorization: "Bearer tok" },
      }),
    );
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ user: "alice" });
  });
});

// ── 多个中间件 ──

describe("multiple middlewares", () => {
  it("executes middlewares in order (first to last), then handler", async () => {
    const order: string[] = [];

    const mw1 = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("mw1-before");
        const res = await next();
        order.push("mw1-after");
        return res;
      };

    const mw2 = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("mw2-before");
        const res = await next();
        order.push("mw2-after");
        return res;
      };

    const route = api(
      { method: "GET", path: "/test", middlewares: [mw1, mw2] },
      async () => {
        order.push("handler");
        return { ok: true };
      },
    );

    await route.handle(req("GET", "/test"));
    expect(order).toEqual([
      "mw1-before",
      "mw2-before",
      "handler",
      "mw2-after",
      "mw1-after",
    ]);
  });

  it("early return in second middleware skips handler", async () => {
    const order: string[] = [];

    const mw1 = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("mw1");
        return next();
      };

    const mw2 = (_next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("mw2-block");
        return new Response("blocked", { status: 403 });
      };

    const route = api(
      { method: "GET", path: "/test", middlewares: [mw1, mw2] },
      async () => {
        order.push("handler");
        return {};
      },
    );

    const res = await route.handle(req("GET", "/test"));
    expect(res.status).toBe(403);
    expect(order).toEqual(["mw1", "mw2-block"]);
  });
});

describe("middleware metadata", () => {
  it("stores inject and validate metadata on the middleware function", () => {
    const currentUser = inject(async () => ({ id: 1 }));
    const injectConfig = { currentUser };
    const validate: Validate<unknown> = (input) => ({
      success: true,
      data: input,
    });

    const auth = middleware((next) => next, {
      inject: injectConfig,
      validate,
    });
    const metadata = auth as Record<PropertyKey, unknown>;

    expect(metadata[middlewareInjectSymbol]).toBe(injectConfig);
    expect(metadata[middlewareValidateSymbol]).toBe(validate);
  });
});

// ── 中间件与参数 ──

describe("middleware params", () => {
  it("middleware accesses query params", async () => {
    let capturedApiKey: unknown;

    const apiKeyCheck = (next: () => Promise<Response>) =>
      async (params: { api_key: unknown }) => {
        capturedApiKey = params.api_key;
        if (!params.api_key) {
          return new Response("Missing API key", { status: 401 });
        }
        return next();
      };

    const route = api(
      { method: "GET", path: "/data", middlewares: [apiKeyCheck] },
      async () => ({ data: [1, 2, 3] }),
    );

    const res = await route.handle(req("GET", "/data?api_key=secret123"));
    expect(res.status).toBe(200);
    expect(capturedApiKey).toBe("secret123");
  });

  it("middleware accesses header params", async () => {
    let capturedToken: unknown;

    const auth = (next: () => Promise<Response>) =>
      async (params: { authorization: unknown }) => {
        capturedToken = params.authorization;
        if (
          typeof params.authorization !== "string" ||
          !params.authorization.startsWith("Bearer ")
        ) {
          return new Response("Invalid token", { status: 401 });
        }
        return next();
      };

    const route = api(
      { method: "GET", path: "/secret", middlewares: [auth] },
      async () => ({ secret: 42 }),
    );

    const res = await route.handle(
      req("GET", "/secret", {
        headers: { Authorization: "Bearer valid-token" },
      }),
    );
    expect(res.status).toBe(200);
    expect(capturedToken).toBe("Bearer valid-token");
  });

  it("middleware accesses cookie params", async () => {
    let capturedSession: unknown;

    const sessionCheck = (next: () => Promise<Response>) =>
      async (params: { sid: unknown }) => {
        capturedSession = params.sid;
        if (!params.sid) {
          return new Response("No session", { status: 401 });
        }
        return next();
      };

    const route = api(
      { method: "GET", path: "/profile", middlewares: [sessionCheck] },
      async () => ({ name: "alice" }),
    );

    const res = await route.handle(
      req("GET", "/profile", {
        headers: { cookie: "sid=sess-abc123" },
      }),
    );
    expect(res.status).toBe(200);
    expect(capturedSession).toBe("sess-abc123");
  });
});

// ── 中间件与 validate 的交互 ──

describe("middleware with validation", () => {
  it("middleware runs before validation", async () => {
    const order: string[] = [];

    const logger = (next: () => Promise<Response>) =>
      async (_params: {}) => {
        order.push("middleware");
        return next();
      };

    const validate = (input: unknown) => {
      order.push("validate");
      const data = input as { name: string };
      return {
        success: typeof data.name === "string",
        data,
        errors: typeof data.name === "string" ? [] : [{ message: "bad" }],
      };
    };

    const route = api(
      { method: "POST", path: "/users", middlewares: [logger] },
      async (params: { name: string }) => {
        order.push("handler");
        return { name: params.name };
      },
      validate,
    );

    await route.handle(jsonReq("POST", "/users", { name: "Alice" }));
    expect(order).toEqual(["middleware", "validate", "handler"]);
  });
});

describe("middleware validate", () => {
  it("passes validated params to middleware handler", async () => {
    const validated: unknown[] = [];
    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (params: { token: string }) => {
          validated.push(params.token);
          return next();
        },
      {
        validate: (input: unknown) => {
          const data = input as Record<string, unknown>;
          if (typeof data.token !== "string") {
            return {
              success: false as const,
              errors: ["token must be string"],
            };
          }
          return { success: true as const, data: data as { token: string } };
        },
      },
    );

    const route = api(
      { method: "GET", path: "/test", middlewares: [mw] },
      async () => ({ ok: true }),
    );

    const response = await route.handle(
      req("GET", "/test", {
        headers: { token: "abc" },
      }),
    );
    expect(response.status).toBe(200);
    expect(validated).toEqual(["abc"]);
  });

  it("returns 400 when middleware validate fails", async () => {
    let handlerCalled = false;
    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => {
          handlerCalled = true;
          return next();
        },
      {
        validate: (_input: unknown) => ({
          success: false as const,
          errors: ["invalid"],
        }),
      },
    );

    const route = api(
      { method: "GET", path: "/test", middlewares: [mw] },
      async () => ({ ok: true }),
    );

    const response = await route.handle(req("GET", "/test"));
    expect(response.status).toBe(400);
    expect(handlerCalled).toBe(false);
  });
});

describe("middleware inject", () => {
  it("resolves injectables and cleans up", async () => {
    const events: string[] = [];

    const dbInjectable = inject(async function* () {
      events.push("db:setup");
      yield { query: () => "result" };
      events.push("db:cleanup");
    });

    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (params: Record<string, unknown>) => {
          events.push("mw:before");
          const db = params.db as { query: () => string };
          events.push(`mw:query=${db.query()}`);
          const res = await next();
          events.push("mw:after");
          return res;
        },
      { inject: { db: dbInjectable } },
    );

    const route = api(
      { method: "GET", path: "/test", middlewares: [mw] },
      async () => {
        events.push("handler");
        return { ok: true };
      },
    );

    const response = await route.handle(req("GET", "/test"));
    expect(response.status).toBe(200);
    expect(events).toEqual([
      "db:setup",
      "mw:before",
      "mw:query=result",
      "handler",
      "mw:after",
      "db:cleanup",
    ]);
  });

  it("skips inject when validate fails", async () => {
    let injectCalled = false;

    const myInject = inject(async () => {
      injectCalled = true;
      return 42;
    });

    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => next(),
      {
        validate: (_input: unknown) => ({
          success: false as const,
          errors: ["bad"],
        }),
        inject: { value: myInject },
      },
    );

    const route = api(
      { method: "GET", path: "/test", middlewares: [mw] },
      async () => ({ ok: true }),
    );

    const response = await route.handle(req("GET", "/test"));
    expect(response.status).toBe(400);
    expect(injectCalled).toBe(false);
  });

  it("runs inject cleanup even when downstream throws", async () => {
    let cleaned = false;

    const myInject = inject(async function* () {
      yield "value";
      cleaned = true;
    });

    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => next(),
      { inject: { value: myInject } },
    );

    const route = api(
      { method: "GET", path: "/test", middlewares: [mw] },
      async () => {
        throw new Error("boom");
      },
    );

    await expect(route.handle(req("GET", "/test"))).rejects.toThrow("boom");
    expect(cleaned).toBe(true);
  });

  it("cleans up multiple middleware injects in onion order", async () => {
    const events: string[] = [];

    const inject1 = inject(async function* () {
      events.push("inject1:setup");
      yield 1;
      events.push("inject1:cleanup");
    });

    const inject2 = inject(async function* () {
      events.push("inject2:setup");
      yield 2;
      events.push("inject2:cleanup");
    });

    const mw1 = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => {
          events.push("mw1:before");
          const res = await next();
          events.push("mw1:after");
          return res;
        },
      { inject: { v1: inject1 } },
    );

    const mw2 = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => {
          events.push("mw2:before");
          const res = await next();
          events.push("mw2:after");
          return res;
        },
      { inject: { v2: inject2 } },
    );

    const route = api(
      { method: "GET", path: "/test", middlewares: [mw1, mw2] },
      async () => {
        events.push("handler");
        return { ok: true };
      },
    );

    const response = await route.handle(req("GET", "/test"));
    expect(response.status).toBe(200);
    expect(events).toEqual([
      "inject1:setup",
      "mw1:before",
      "inject2:setup",
      "mw2:before",
      "handler",
      "mw2:after",
      "inject2:cleanup",
      "mw1:after",
      "inject1:cleanup",
    ]);
  });
});

describe("middleware inject with params", () => {
  it("injectable receives extracted request params", async () => {
    let receivedParams: Record<string, unknown> | null = null;
    let receivedCtx: { request: Request } | null = null;

    const userLoader = inject(
      async (params: Record<string, unknown>, ctx: { request: Request }) => {
        receivedParams = { ...params };
        receivedCtx = ctx;
        return { id: params.id, name: "Alice" };
      },
    );

    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (params: Record<string, unknown>) => {
          const user = params.user as { id: unknown; name: string } | undefined;
          if (!user) {
            return new Response("No user", { status: 401 });
          }
          return next();
        },
      { inject: { user: userLoader } },
    );

    const route = api(
      { method: "GET", path: "/users/:id", middlewares: [mw] },
      async (params: Record<string, unknown>) => {
        const user = params.user as { id: unknown; name: string } | undefined;
        return { userId: user?.id };
      },
    );

    const response = await route.handle(req("GET", "/users/42"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 42 });
    expect(receivedParams).not.toBeNull();
    expect(receivedParams?.id).toBe(42);
    expect(receivedCtx?.request).toBeInstanceOf(Request);
  });
});

describe("middleware validate with POST body", () => {
  it("validates JSON body params", async () => {
    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => {
          return next();
        },
      {
        validate: (input: unknown) => {
          const data = input as Record<string, unknown>;
          if (typeof data.name !== "string" || data.name.length === 0) {
            return { success: false as const, errors: ["name is required"] };
          }
          return { success: true as const, data };
        },
      },
    );

    const route = api(
      { method: "POST", path: "/items", middlewares: [mw] },
      async (params: { name: string }) => ({ created: params.name }),
    );

    const fail = await route.handle(jsonReq("POST", "/items", {}));
    expect(fail.status).toBe(400);

    const ok = await route.handle(
      jsonReq("POST", "/items", { name: "Widget" }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ created: "Widget" });
  });
});

describe("middleware chain: validate + inject composition", () => {
  it("first middleware validates then injects, second middleware injects, handler uses all", async () => {
    const events: string[] = [];

    const userLoader = inject(async function* (_params: Record<string, unknown>) {
      events.push("user:setup");
      yield { id: 1, role: "admin" };
      events.push("user:cleanup");
    });

    const tenantLoader = inject(async function* () {
      events.push("tenant:setup");
      yield { tenantId: "t-100", plan: "pro" };
      events.push("tenant:cleanup");
    });

    const authMw = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => {
          events.push("auth:check");
          return next();
        },
      {
        validate: (input: unknown) => {
          const data = input as Record<string, unknown>;
          if (!data.authorization) {
            return { success: false as const, errors: ["missing auth"] };
          }
          return { success: true as const, data };
        },
        inject: { user: userLoader },
      },
    );

    const tenantMw = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => {
          events.push("tenant:check");
          return next();
        },
      { inject: { tenant: tenantLoader } },
    );

    const route = api(
      { method: "GET", path: "/data", middlewares: [authMw, tenantMw] },
      async (params: Record<string, unknown>) => {
        events.push("handler");
        return {
          user: params.user,
          tenant: params.tenant,
        };
      },
    );

    const fail = await route.handle(req("GET", "/data"));
    expect(fail.status).toBe(400);
    expect(events).toEqual([]);

    events.length = 0;

    const ok = await route.handle(
      req("GET", "/data", { headers: { authorization: "Bearer token" } }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      user: { id: 1, role: "admin" },
      tenant: { tenantId: "t-100", plan: "pro" },
    });
    expect(events).toEqual([
      "user:setup",
      "auth:check",
      "tenant:setup",
      "tenant:check",
      "handler",
      "tenant:cleanup",
      "user:cleanup",
    ]);
  });
});

describe("middleware inject values visible to handler", () => {
  it("handler can access middleware-injected values", async () => {
    const config = inject(async () => ({ apiVersion: "v2", maxRetries: 3 }));

    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => next(),
      { inject: { config } },
    );

    const route = api(
      { method: "GET", path: "/info", middlewares: [mw] },
      async (params: Record<string, unknown>) => {
        const cfg = params.config as
          | { apiVersion: string; maxRetries: number }
          | undefined;
        return { version: cfg?.apiVersion, retries: cfg?.maxRetries };
      },
    );

    const response = await route.handle(req("GET", "/info"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: "v2", retries: 3 });
  });
});

describe("middleware inject/validate with routes()", () => {
  it("works through route grouping", async () => {
    const events: string[] = [];

    const dep = inject(async function* () {
      events.push("setup");
      yield "injected";
      events.push("cleanup");
    });

    const mw = middleware(
      (next: () => Promise<Response>) =>
        async (_params: Record<string, unknown>) => {
          events.push("mw");
          return next();
        },
      {
        validate: (input: unknown) => {
          const data = input as Record<string, unknown>;
          if (data.token !== "ok") {
            return {
              success: false as const,
              errors: ["missing token"],
            };
          }
          return { success: true as const, data };
        },
        inject: { dep },
      },
    );

    const route = api(
      { method: "GET", path: "/test" },
      async (params: Record<string, unknown>) => ({ value: params.dep }),
    );

    const [groupedRoute] = routes({ prefix: "/api", middlewares: [mw] }, route);
    if (!groupedRoute) {
      throw new Error("Expected grouped route");
    }

    const fail = await groupedRoute.handle(req("GET", "/api/test"));
    expect(fail.status).toBe(400);
    expect(events).toEqual([]);

    const response = await groupedRoute.handle(
      req("GET", "/api/test", { headers: { token: "ok" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: "injected" });
    expect(events).toEqual(["setup", "mw", "cleanup"]);
  });
});
