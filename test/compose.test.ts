import { describe, expect, it } from "vitest";
import { api } from "../src/api.js";
import { cors } from "../src/cors.js";
import { composeHandlers, createRouter } from "../src/router.js";

function req(method: string, url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, { method, ...options });
}

describe("composeHandlers", () => {
  const publicRoute = api(
    { method: "GET", path: "/api/public/items" },
    async () => [{ id: 1 }],
  );
  const internalRoute = api(
    { method: "GET", path: "/api/internal/items" },
    async () => [{ id: 2 }],
  );

  const publicApi = createRouter([publicRoute], {
    middlewares: [cors({ origin: "*" })],
  });
  const internalApi = createRouter([internalRoute], {
    middlewares: [cors({ origin: "https://admin.example.com" })],
  });
  const app = composeHandlers(publicApi, internalApi);

  it("dispatches to the first matching router", async () => {
    const res = await app(req("GET", "/api/public/items"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("falls through to the next router on 404", async () => {
    const res = await app(req("GET", "/api/internal/items"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 2 }]);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://admin.example.com",
    );
  });

  it("returns 404 when no router matches", async () => {
    const res = await app(req("GET", "/unknown"));
    expect(res.status).toBe(404);
  });

  it("applies correct CORS policy on preflight per router", async () => {
    const publicPreflight = await app(
      req("OPTIONS", "/api/public/items", {
        headers: {
          Origin: "https://any.example.com",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect(publicPreflight.status).toBe(204);
    expect(publicPreflight.headers.get("Allow")).toBe("GET, OPTIONS");
    expect(publicPreflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "*",
    );

    const internalPreflight = await app(
      req("OPTIONS", "/api/internal/items", {
        headers: {
          Origin: "https://admin.example.com",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect(internalPreflight.status).toBe(204);
    expect(internalPreflight.headers.get("Allow")).toBe("GET, OPTIONS");
    expect(internalPreflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://admin.example.com",
    );
  });

  it("preflight to non-existing endpoint returns 404", async () => {
    const res = await app(
      req("OPTIONS", "/unknown", {
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect(res.status).toBe(404);
  });
});
