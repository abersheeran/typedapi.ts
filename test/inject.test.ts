import { describe, expect, it } from "vitest";
import { api, createRouter, routes } from "../src/index.js";
import { inject, resolveInjectables } from "../src/inject.js";

function req(method: string, url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, { method, ...options });
}

describe("inject", () => {
  it("resolves promises and generators, and cleans generators in reverse order", async () => {
    const events: string[] = [];

    const first = inject(async function* () {
      events.push("start:first");
      yield "first";
      events.push("cleanup:first");
    });

    const second = inject(async function* () {
      events.push("start:second");
      yield "second";
      events.push("cleanup:second");
      throw new Error("cleanup failure");
    });

    const third = inject(async () => {
      events.push("start:third");
      return "third";
    });

    const { values, cleanup } = await resolveInjectables({
      first,
      second,
      third,
    });

    expect(values).toEqual({
      first: "first",
      second: "second",
      third: "third",
    });
    expect(events).toEqual(["start:first", "start:second", "start:third"]);

    await cleanup();

    expect(events).toEqual([
      "start:first",
      "start:second",
      "start:third",
      "cleanup:second",
      "cleanup:first",
    ]);
  });

  it("reuses cached injectables by instance and respects cache=false", async () => {
    let cachedCalls = 0;
    let uncachedCalls = 0;

    const cached = inject(async () => {
      cachedCalls += 1;
      return { id: cachedCalls };
    });

    const uncached = inject(
      async () => {
        uncachedCalls += 1;
        return { id: uncachedCalls };
      },
      { cache: false },
    );

    const cachedResult = await resolveInjectables({
      left: cached,
      right: cached,
    });
    const uncachedResult = await resolveInjectables({
      left: uncached,
      right: uncached,
    });

    expect(cachedCalls).toBe(1);
    expect(cachedResult.values.left).toBe(cachedResult.values.right);
    expect(uncachedCalls).toBe(2);
    expect(uncachedResult.values.left).not.toBe(uncachedResult.values.right);
  });

  it("injects values into api() route handlers", async () => {
    const injectable = inject(async function* () {
      yield "injected-value";
    });

    const route = api(
      { method: "GET", path: "/test" },
      async (params: Record<string, unknown>) => ({ db: params.db }),
      { inject: { db: injectable } },
    );

    const response = await route.handle(req("GET", "/test"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ db: "injected-value" });
  });

  it("runs generator cleanup after the request finishes", async () => {
    const events: string[] = [];

    const resource = inject(async function* () {
      events.push("start");
      yield "resource";
      events.push("cleanup");
    });

    const route = api(
      { method: "GET", path: "/cleanup" },
      async (params: Record<string, unknown>) => {
        events.push(`handler:${params.resource}`);
        return { ok: true };
      },
      { inject: { resource } },
    );

    const response = await route.handle(req("GET", "/cleanup"));

    expect(response.status).toBe(200);
    expect(events).toEqual(["start", "handler:resource", "cleanup"]);
  });

  it("still cleans generators when the handler throws", async () => {
    const events: string[] = [];

    const resource = inject(async function* () {
      events.push("start");
      yield "resource";
      events.push("cleanup");
    });

    const route = api(
      { method: "GET", path: "/boom" },
      async () => {
        events.push("handler");
        throw new Error("handler failure");
      },
      { inject: { resource } },
    );

    await expect(route.handle(req("GET", "/boom"))).rejects.toThrow(
      "handler failure",
    );
    expect(events).toEqual(["start", "handler", "cleanup"]);
  });

  it("reuses cached injectables across different inject keys in a route", async () => {
    let calls = 0;

    const shared = inject(async () => {
      calls += 1;
      return { id: calls };
    });

    const route = api(
      { method: "GET", path: "/cache" },
      async (params: Record<string, unknown>) => {
        const left = params.left as { id: number };
        const right = params.right as { id: number };

        return {
          calls,
          sameInstance: left === right,
          leftId: left.id,
          rightId: right.id,
        };
      },
      { inject: { left: shared, right: shared } },
    );

    const response = await route.handle(req("GET", "/cache"));

    expect(response.status).toBe(200);
    expect(calls).toBe(1);
    expect(await response.json()).toEqual({
      calls: 1,
      sameInstance: true,
      leftId: 1,
      rightId: 1,
    });
  });

  it("makes inject values and path params available together", async () => {
    const tenant = inject(async () => "tenant-a");

    const route = api(
      { method: "GET", path: "/users/:id" },
      async (params: Record<string, unknown>) => ({
        id: params.id,
        tenant: params.tenant,
      }),
      { inject: { tenant } },
    );

    const response = await route.handle(req("GET", "/users/42"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 42, tenant: "tenant-a" });
  });

  it("preserves inject config when routes() wraps a route", async () => {
    const service = inject(async () => "wrapped");

    const route = api(
      { method: "GET", path: "/test" },
      async (params: Record<string, unknown>) => ({ service: params.service }),
      { inject: { service } },
    );

    const [wrapped] = routes({ prefix: "/api" }, route);
    const app = createRouter([wrapped]);

    expect(wrapped.config.inject).toBe(route.config.inject);

    const response = await app(req("GET", "/api/test"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "wrapped" });
  });

  it("passes extracted request params to inject function", async () => {
    let receivedId: unknown;

    const itemId = inject(async (params) => {
      receivedId = params.id;
      return params.id;
    });

    const route = api(
      { method: "GET", path: "/items/:id" },
      async (params: Record<string, unknown>) => ({ itemId: params.itemId }),
      { inject: { itemId } },
    );

    const response = await route.handle(req("GET", "/items/42"));

    expect(response.status).toBe(200);
    expect(receivedId).toBe(42);
    expect(await response.json()).toEqual({ itemId: 42 });
  });

  it("inject receives query and header params", async () => {
    const authContext = inject(async (params) => ({
      authorization: params.authorization,
      q: params.q,
    }));

    const route = api(
      { method: "GET", path: "/search" },
      async (params: Record<string, unknown>) => ({ auth: params.auth }),
      { inject: { auth: authContext } },
    );

    const response = await route.handle(
      req("GET", "/search?q=books", {
        headers: {
          Authorization: "Bearer token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      auth: {
        authorization: "Bearer token",
        q: "books",
      },
    });
  });

  it("inject with params works alongside generator cleanup", async () => {
    const events: string[] = [];

    const resource = inject(async function* (params) {
      events.push(`start:${params.id}`);
      yield `resource:${params.id}`;
      events.push(`cleanup:${params.id}`);
    });

    const route = api(
      { method: "GET", path: "/items/:id" },
      async (params: Record<string, unknown>) => {
        events.push(`handler:${params.resource}`);
        return { resource: params.resource };
      },
      { inject: { resource } },
    );

    const response = await route.handle(req("GET", "/items/7"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resource: "resource:7" });
    expect(events).toEqual(["start:7", "handler:resource:7", "cleanup:7"]);
  });

  it("inject with params and cache still works", async () => {
    let calls = 0;
    let receivedId: unknown;

    const shared = inject(async (params) => {
      calls += 1;
      receivedId = params.id;
      return { id: params.id };
    });

    const route = api(
      { method: "GET", path: "/items/:id" },
      async (params: Record<string, unknown>) => {
        const left = params.left as { id: unknown };
        const right = params.right as { id: unknown };

        return {
          calls,
          leftId: left.id,
          rightId: right.id,
          sameInstance: left === right,
        };
      },
      { inject: { left: shared, right: shared } },
    );

    const response = await route.handle(req("GET", "/items/123"));

    expect(response.status).toBe(200);
    expect(calls).toBe(1);
    expect(receivedId).toBe(123);
    expect(await response.json()).toEqual({
      calls: 1,
      leftId: 123,
      rightId: 123,
      sameInstance: true,
    });
  });
});
