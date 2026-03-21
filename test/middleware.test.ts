import { describe, it, expect } from "vitest";
import { api } from "../src/api.js";

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
