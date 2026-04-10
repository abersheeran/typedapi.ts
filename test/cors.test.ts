import { describe, expect, it } from "vitest";
import { api } from "../src/api.js";
import { cors } from "../src/cors.js";
import { createRouter } from "../src/router.js";

function req(method: string, url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, { method, ...options });
}

describe("cors middleware", () => {
  it("adds default allow origin header to non-preflight responses", async () => {
    const route = api(
      { method: "GET", path: "/items" },
      async () =>
        new Response("ok", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    );
    const app = createRouter([route], { middlewares: [cors()] });

    const res = await app(
      req("GET", "/items", {
        headers: { Origin: "https://example.com" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Vary")).toBeNull();
    expect(await res.text()).toBe("ok");
  });

  it("adds configured headers to non-preflight responses", async () => {
    const route = api(
      {
        method: "GET",
        path: "/items",
      },
      async () =>
        new Response("ok", {
          headers: { Vary: "Accept-Encoding" },
        }),
    );
    const app = createRouter([route], {
      middlewares: [
        cors({
          origin: ["https://allowed.example"],
          credentials: true,
          exposeHeaders: ["x-total-count", "x-request-id"],
        }),
      ],
    });

    const res = await app(
      req("GET", "/items", {
        headers: { Origin: "https://allowed.example" },
      }),
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://allowed.example",
    );
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
      "x-total-count, x-request-id",
    );
    expect(res.headers.get("Vary")).toBe("Accept-Encoding, Origin");
  });

  it("adds CORS headers onto the router-generated preflight response", async () => {
    let called = false;
    const route = api({ method: "POST", path: "/items" }, async () => {
      called = true;
      return { ok: true };
    });
    const app = createRouter([route], {
      middlewares: [
        cors({
          origin: (origin) => origin.endsWith(".example"),
          methods: ["GET", "POST"],
          maxAge: 600,
        }),
      ],
    });

    const res = await app(
      req("OPTIONS", "/items", {
        headers: {
          Origin: "https://api.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type, x-api-key",
        },
      }),
    );

    expect(called).toBe(false);
    expect(res.status).toBe(204);
    expect(res.headers.get("Allow")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://api.example",
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
      "content-type, x-api-key",
    );
    expect(res.headers.get("Access-Control-Max-Age")).toBe("600");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("returns false allow origin when request origin is not allowed", async () => {
    const route = api({ method: "POST", path: "/items" }, async () => ({ ok: true }));
    const app = createRouter([route], {
      middlewares: [
        cors({
          origin: ["https://allowed.example"],
          allowHeaders: ["content-type", "x-api-key"],
        }),
      ],
    });
    const res = await app(
      req("OPTIONS", "/items", {
        headers: {
          Origin: "https://blocked.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "x-ignored",
        },
      }),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("Allow")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("false");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
      "content-type, x-api-key",
    );
  });
});
