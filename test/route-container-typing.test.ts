import { describe, expect, it } from "vitest";
import {
  api,
  cors,
  createRouter,
  routes,
  type AnyRoute,
  type Json,
  type JsonResponse,
  type Path,
  type Query,
  type RouterMiddleware,
} from "../src/index.js";

const getUser = api(
  { method: "GET", path: "/users/:id" },
  async (params: { id: Path<number> }) => ({ id: params.id }),
);

const createUser = api(
  { method: "POST", path: "/users" },
  async (params: {
    name: Json<string>;
    age: Json<number>;
  }): Promise<JsonResponse<201, {}, { id: number }>> => ({ id: 1 }),
);

const searchUsers = api(
  { method: "GET", path: "/users" },
  async (params: { q: Query<string>; limit: Query<number> }) => ({
    q: params.q,
    limit: params.limit,
  }),
);

const routeList: AnyRoute[] = [getUser, createUser, searchUsers];

const router1 = createRouter([getUser, createUser, searchUsers]);

const grouped = routes(
  { prefix: "/api" },
  getUser,
  createUser,
  searchUsers,
);
const router2 = createRouter(grouped);
const routerMiddleware: RouterMiddleware = async (_request, next) => next();
const router3 = createRouter([getUser], {
  middlewares: [routerMiddleware, cors()],
});

describe("Route container typing", () => {
  it("compiles with heterogeneous Route params", () => {
    expect(typeof router1).toBe("function");
    expect(typeof router2).toBe("function");
    expect(typeof router3).toBe("function");
    expect(routeList.length).toBe(3);
  });
});
