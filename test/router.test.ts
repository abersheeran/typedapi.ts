import { describe, it, expect } from "vitest";
import { api } from "../src/api.js";
import { createRouter } from "../src/router.js";

function req(method: string, url: string) {
  return new Request(`http://localhost${url}`, { method });
}

describe("createRouter", () => {
  const getUsers = api(
    { method: "GET", path: "/users" },
    async () => [{ id: 1 }],
  );

  const getUser = api(
    { method: "GET", path: "/users/:id" },
    async (p: { id: unknown }) => ({ id: p.id }),
  );

  const createUser = api(
    { method: "POST", path: "/users" },
    async (p: { name: unknown }) => ({ name: p.name }),
  );

  const app = createRouter([getUsers, getUser, createUser]);

  it("routes GET /users", async () => {
    const res = await app(req("GET", "/users"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it("routes GET /users/:id", async () => {
    const res = await app(req("GET", "/users/5"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 5 });
  });

  it("routes GET / with a root path route", async () => {
    const root = api({ method: "GET", path: "/" }, async () => ({ root: true }));
    const router = createRouter([root]);
    const res = await router(req("GET", "/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root: true });
  });

  it("routes POST /users", async () => {
    const res = await app(
      new Request("http://localhost/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Bob" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Bob" });
  });

  it("returns 404 for unmatched path", async () => {
    const res = await app(req("GET", "/unknown"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Not Found" });
  });

  it("returns 404 for wrong method on existing path", async () => {
    const res = await app(req("DELETE", "/users"));
    expect(res.status).toBe(404);
  });

  it("routes PUT, DELETE, and PATCH methods", async () => {
    const updateUser = api(
      { method: "PUT", path: "/users/:id" },
      async (p: { id: unknown }) => ({ method: "PUT", id: p.id }),
    );
    const deleteUser = api(
      { method: "DELETE", path: "/users/:id" },
      async (p: { id: unknown }) => ({ method: "DELETE", id: p.id }),
    );
    const patchUser = api(
      { method: "PATCH", path: "/users/:id" },
      async (p: { id: unknown }) => ({ method: "PATCH", id: p.id }),
    );
    const router = createRouter([updateUser, deleteUser, patchUser]);

    expect(await (await router(req("PUT", "/users/5"))).json()).toEqual({
      method: "PUT",
      id: 5,
    });
    expect(await (await router(req("DELETE", "/users/5"))).json()).toEqual({
      method: "DELETE",
      id: 5,
    });
    expect(await (await router(req("PATCH", "/users/5"))).json()).toEqual({
      method: "PATCH",
      id: 5,
    });
  });

  it("first matching route wins", async () => {
    const first = api(
      { method: "GET", path: "/dup" },
      async () => ({ winner: "first" }),
    );
    const second = api(
      { method: "GET", path: "/dup" },
      async () => ({ winner: "second" }),
    );
    const router = createRouter([first, second]);
    const res = await router(req("GET", "/dup"));
    expect(await res.json()).toEqual({ winner: "first" });
  });

  it("static routes still match trailing slash", async () => {
    const router = createRouter([getUsers]);
    const res = await router(req("GET", "/users/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it("dynamic routes still match trailing slash", async () => {
    const router = createRouter([getUser]);
    const res = await router(req("GET", "/users/5/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 5 });
  });

  it("ignores query strings for static route matching", async () => {
    const res = await app(req("GET", "/users?page=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it("returns 404 rather than 405 for a different method on the same path", async () => {
    const res = await app(req("PATCH", "/users"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Not Found" });
  });

  it("empty router returns 404", async () => {
    const router = createRouter([]);
    const res = await router(req("GET", "/anything"));
    expect(res.status).toBe(404);
  });
});
