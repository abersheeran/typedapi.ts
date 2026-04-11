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

describe("injectable dependencies", () => {
  const createCtx = () => ({
    request: new Request("http://localhost"),
    context: undefined,
  });

  it("resolves dependent injectable and passes it as params", async () => {
    const base = inject(async () => ({ label: "base-value" }));

    const derived = inject(
      async (params: { base: { label: string } }) => {
        return { derivedLabel: `derived:${params.base.label}` };
      },
      { inject: { base } },
    );

    const { values, cleanup } = await resolveInjectables(
      { derived },
      {},
      createCtx(),
    );

    expect(values.derived).toEqual({ derivedLabel: "derived:base-value" });
    await cleanup();
  });

  it("resolves multi-level dependencies in correct order", async () => {
    const events: string[] = [];

    const level1 = inject(async function* () {
      events.push("l1:setup");
      yield { level: 1 };
      events.push("l1:cleanup");
    });

    const level2 = inject(
      async function* (params: { l1: { level: number } }) {
        events.push("l2:setup");
        yield { level: 2, parent: params.l1.level };
        events.push("l2:cleanup");
      },
      { inject: { l1: level1 } },
    );

    const level3 = inject(
      async function* (params: { l2: { level: number; parent: number } }) {
        events.push("l3:setup");
        yield { level: 3, parent: params.l2.level };
        events.push("l3:cleanup");
      },
      { inject: { l2: level2 } },
    );

    const { values, cleanup } = await resolveInjectables(
      { l3: level3 },
      {},
      createCtx(),
    );

    expect(values.l3).toEqual({ level: 3, parent: 2 });
    expect(events).toEqual(["l1:setup", "l2:setup", "l3:setup"]);

    await cleanup();

    expect(events).toEqual([
      "l1:setup",
      "l2:setup",
      "l3:setup",
      "l3:cleanup",
      "l2:cleanup",
      "l1:cleanup",
    ]);
  });

  it("shares a dependency across multiple dependents", async () => {
    let sharedCalls = 0;

    const shared = inject(async () => {
      sharedCalls += 1;
      return { id: sharedCalls };
    });

    const depA = inject(
      async (params: { shared: { id: number } }) => ({
        from: "a",
        sharedId: params.shared.id,
      }),
      { inject: { shared } },
    );

    const depB = inject(
      async (params: { shared: { id: number } }) => ({
        from: "b",
        sharedId: params.shared.id,
      }),
      { inject: { shared } },
    );

    const { values } = await resolveInjectables(
      { a: depA, b: depB },
      {},
      createCtx(),
    );

    expect(sharedCalls).toBe(1);
    expect(values.a).toEqual({ from: "a", sharedId: 1 });
    expect(values.b).toEqual({ from: "b", sharedId: 1 });
  });

  it("throws on circular dependencies", async () => {
    const mutableA: any = {
      __brand: "injectable",
      fn: async () => ({ name: "a" }),
      cache: true,
    };
    const mutableB: any = {
      __brand: "injectable",
      fn: async () => ({ name: "b" }),
      cache: true,
      inject: { a: mutableA },
    };
    mutableA.inject = { b: mutableB };

    await expect(
      resolveInjectables({ entry: mutableA }, {}, createCtx()),
    ).rejects.toThrow("Circular injectable dependency detected");
  });

  it("merges request params with dependency values", async () => {
    const dep = inject(async () => ({ depValue: "from-dep" }));

    const consumer = inject(
      async (params: { userId: string; dep: { depValue: string } }) => {
        return {
          user: params.userId,
          dep: params.dep.depValue,
        };
      },
      { inject: { dep } },
    );

    const { values } = await resolveInjectables(
      { result: consumer },
      { userId: "user-123" },
      createCtx(),
    );

    expect(values.result).toEqual({ user: "user-123", dep: "from-dep" });
  });

  it("runs cleanup for already-built dependencies when a later one throws", async () => {
    let cleaned = false;

    const good = inject(async function* () {
      yield "good";
      cleaned = true;
    });

    const bad = inject(
      async (_params: Record<string, unknown>) => {
        throw new Error("boom");
      },
      { inject: { good } },
    );

    await expect(
      resolveInjectables({ result: bad }, {}, createCtx()),
    ).rejects.toThrow("boom");

    expect(cleaned).toBe(true);
  });
});

describe("nested injectables through api()", () => {
  it("handler receives values from injectable with dependencies", async () => {
    const db = inject(async () => ({ name: "db-instance" }));

    const userService = inject(
      async (params: { db: { name: string } }) => ({
        loadUser: () => `user-from-${params.db.name}`,
      }),
      { inject: { db } },
    );

    const route = api(
      { method: "GET", path: "/me" },
      async (params: Record<string, unknown>) => {
        const svc = params.userService as { loadUser: () => string };
        return { user: svc.loadUser() };
      },
      { inject: { userService } },
    );

    const response = await route.handle(req("GET", "/me"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: string };
    expect(body.user).toBe("user-from-db-instance");
  });
});
