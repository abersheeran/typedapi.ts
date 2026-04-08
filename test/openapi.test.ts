import { describe, expect, it } from "vitest";
import { api } from "../src/api.js";
import { inject } from "../src/inject.js";
import { middleware } from "../src/middleware.js";
import { openapi } from "../src/openapi.js";
import { routes } from "../src/routes.js";

describe("openapi", () => {
  it("generates paths for exposed routes only", () => {
    const exposed = api(
      { method: "GET", path: "/orders/:id", expose: true },
      async () => ({ ok: true }),
    );
    const hidden = api(
      { method: "GET", path: "/internal", expose: false },
      async () => ({ ok: true }),
    );

    const document = openapi({
      info: { title: "Test API", version: "1.0.0" },
      routes: [exposed, hidden],
    });

    expect(document.paths).toEqual({
      "/orders/{id}": {
        get: {
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "",
            },
          },
        },
      },
    });
  });

  it("parses direct response schemas and merges components", () => {
    const route = api(
      { method: "POST", path: "/orders", expose: true },
      async () => ({ id: 1 }),
      {
        responses: {
          schemas: [
            {
              type: "object",
              properties: {
                id: { type: "integer" },
                __response: {
                  type: "object",
                  properties: {
                    status: { const: 201 },
                  },
                },
              },
              required: ["id", "__response"],
            },
          ],
          components: {
            schemas: {
              Order: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                },
              },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test API", version: "1.0.0" },
      routes: [route],
    });

    expect(document.components.schemas).toEqual({
      Order: {
        type: "object",
        properties: {
          id: { type: "integer" },
        },
      },
    });
    expect(document.paths["/orders"].post.responses).toEqual({
      201: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                id: { type: "integer" },
              },
              required: ["id"],
            },
          },
        },
      },
    });
  });

  it("expands oneOf responses and resolves top-level refs", () => {
    const route = api(
      { method: "POST", path: "/users", expose: true },
      async () => ({ ok: true }),
      {
        responses: {
          schemas: [
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    id: { type: "integer" },
                    __response: {
                      type: "object",
                      properties: {
                        status: { const: 201 },
                      },
                    },
                  },
                  required: ["id", "__response"],
                },
                {
                  $ref: "#/components/schemas/CreateUserConflict",
                },
              ],
            },
          ],
          components: {
            schemas: {
              CreateUserConflict: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  __response: {
                    type: "object",
                    properties: {
                      status: { const: 409 },
                    },
                  },
                },
                required: ["message", "__response"],
              },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test API", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/users"].post.responses).toEqual({
      201: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                id: { type: "integer" },
              },
              required: ["id"],
            },
          },
        },
      },
      409: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        },
      },
    });
  });

  it("generates responses from __responses format", () => {
    const route = api(
      { method: "GET", path: "/products/:id", expose: true },
      async () => ({ ok: true }),
      {
        responses: {
          __responses: [
            {
              status: 200,
              headers: {},
              schema: {
                type: "object",
                properties: {
                  id: { type: "number" },
                  name: { type: "string" },
                  price: { type: "number" },
                },
                required: ["id", "name", "price"],
              },
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/products/{id}"].get.responses).toEqual({
      200: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                id: { type: "number" },
                name: { type: "string" },
                price: { type: "number" },
              },
              required: ["id", "name", "price"],
            },
          },
        },
      },
    });
  });

  it("generates multiple responses from __responses format", () => {
    const route = api(
      { method: "POST", path: "/orders", expose: true },
      async () => ({ ok: true }),
      {
        responses: {
          __responses: [
            {
              status: 201,
              headers: {},
              schema: {
                type: "object",
                properties: { id: { type: "number" } },
                required: ["id"],
              },
            },
            {
              status: 400,
              headers: {},
              schema: {
                type: "object",
                properties: { message: { type: "string" } },
                required: ["message"],
              },
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/orders"].post.responses).toEqual({
      201: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { id: { type: "number" } },
              required: ["id"],
            },
          },
        },
      },
      400: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
            },
          },
        },
      },
    });
  });

  it("generates response headers from __responses format", () => {
    const route = api(
      { method: "GET", path: "/test", expose: true },
      async () => ({ ok: true }),
      {
        responses: {
          __responses: [
            {
              status: 200,
              headers: { "x-request-id": "string" },
              schema: {
                type: "object",
                properties: { ok: { type: "boolean" } },
                required: ["ok"],
              },
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/test"].get.responses["200"].headers).toEqual({
      "x-request-id": {
        schema: { type: "string", const: "string" },
      },
    });
  });

  it("uses grouped route paths after prefix composition", () => {
    const [route] = routes(
      { prefix: "/api" },
      api(
        { method: "GET", path: "/orders/:id", expose: true },
        async () => ({ id: 1 }),
      ),
    );

    const document = openapi({
      info: { title: "Test API", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/api/orders/{id}"]).toBeDefined();
  });

  it("preserves parameters metadata through routes() prefix wrapping", () => {
    const [route] = routes(
      { prefix: "/api" },
      api(
        { method: "GET", path: "/reports/:id", expose: true },
        async () => ({ ok: true }),
        {
          parameters: {
            __entries: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
          },
        },
      ),
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/api/reports/{id}"].get.parameters).toEqual([
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ]);
  });

  it("generates parameters from __params metadata", () => {
    const route = api(
      { method: "GET", path: "/products/:id", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: { $ref: "#/components/schemas/Params" },
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  id: { $ref: "#/components/schemas/Pathnumber" },
                  currency: { $ref: "#/components/schemas/Querystring" },
                  authorization: { $ref: "#/components/schemas/Headerstring" },
                  storeId: { $ref: "#/components/schemas/Cookiestring" },
                  __params: {
                    type: "object",
                    properties: {
                      id: {
                        type: "object",
                        properties: {
                          in: { const: "path" },
                          title: { const: "Product ID" },
                          example: { const: 42 },
                        },
                        required: ["in", "title", "example"],
                      },
                      currency: {
                        type: "object",
                        properties: {
                          in: { const: "query" },
                          title: { const: "Currency" },
                          description: { const: "ISO 4217 currency code" },
                        },
                        required: ["in", "title", "description"],
                      },
                      authorization: {
                        type: "object",
                        properties: {
                          in: { const: "header" },
                          alias: { const: "Authorization" },
                          title: { const: "Access Token" },
                        },
                        required: ["in", "alias", "title"],
                      },
                      storeId: {
                        type: "object",
                        properties: {
                          in: { const: "cookie" },
                          alias: { const: "x-store-id" },
                          title: { const: "Store ID" },
                        },
                        required: ["in", "alias", "title"],
                      },
                    },
                    required: ["id", "currency", "authorization", "storeId"],
                  },
                },
                required: ["id", "currency", "authorization", "storeId"],
              },
              Pathnumber: { type: "number" },
              Querystring: { type: "string" },
              Headerstring: { type: "string" },
              Cookiestring: { type: "string" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    const op = document.paths["/products/{id}"].get;
    expect(op.parameters).toEqual([
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "number", title: "Product ID" },
        example: 42,
      },
      {
        name: "currency",
        in: "query",
        required: true,
        schema: { type: "string", title: "Currency" },
        description: "ISO 4217 currency code",
      },
      {
        name: "Authorization",
        in: "header",
        required: true,
        schema: { type: "string", title: "Access Token" },
      },
      {
        name: "x-store-id",
        in: "cookie",
        required: true,
        schema: { type: "string", title: "Store ID" },
      },
    ]);
  });

  it("generates requestBody from body params with metadata", () => {
    const route = api(
      { method: "POST", path: "/products", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: { $ref: "#/components/schemas/Params" },
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  name: { $ref: "#/components/schemas/Jsonstring" },
                  price: { $ref: "#/components/schemas/Jsonnumber" },
                  __params: {
                    type: "object",
                    properties: {
                      name: {
                        type: "object",
                        properties: {
                          in: { const: "body" },
                          title: { const: "Product Name" },
                        },
                        required: ["in", "title"],
                      },
                      price: {
                        type: "object",
                        properties: {
                          in: { const: "body" },
                          title: { const: "Price" },
                          description: { const: "Price in cents" },
                          example: { const: 9900 },
                        },
                        required: ["in", "title", "description", "example"],
                      },
                    },
                    required: ["name", "price"],
                  },
                },
                required: ["name", "price"],
              },
              Jsonstring: { type: "string" },
              Jsonnumber: { type: "number" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    const op = document.paths["/products"].post;
    expect(op.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: { type: "string", title: "Product Name" },
              price: {
                type: "number",
                title: "Price",
                description: "Price in cents",
                example: 9900,
              },
            },
            required: ["name", "price"],
          },
        },
      },
    });
    expect(op.parameters).toEqual([]);
  });

  it("marks deprecated parameters from metadata", () => {
    const route = api(
      { method: "GET", path: "/legacy", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: { $ref: "#/components/schemas/Params" },
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  "x-api-version": { $ref: "#/components/schemas/Headerstring" },
                  __params: {
                    type: "object",
                    properties: {
                      "x-api-version": {
                        type: "object",
                        properties: {
                          in: { const: "header" },
                          deprecated: { const: true },
                          title: { const: "API Version" },
                          description: {
                            const: "Use URL versioning instead",
                          },
                        },
                        required: [
                          "in",
                          "deprecated",
                          "title",
                          "description",
                        ],
                      },
                    },
                    required: ["x-api-version"],
                  },
                },
                required: ["x-api-version"],
              },
              Headerstring: { type: "string" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/legacy"].get.parameters[0]).toEqual({
      name: "x-api-version",
      in: "header",
      required: true,
      schema: { type: "string", title: "API Version" },
      deprecated: true,
      description: "Use URL versioning instead",
    });
  });

  it("detects optional parameters from required array", () => {
    const route = api(
      { method: "GET", path: "/search", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: { $ref: "#/components/schemas/Params" },
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  q: { $ref: "#/components/schemas/Querystring" },
                  page: { $ref: "#/components/schemas/Querynumber" },
                  __params: {
                    type: "object",
                    properties: {
                      q: {
                        type: "object",
                        properties: {
                          in: { const: "query" },
                          title: { const: "Keyword" },
                        },
                        required: ["in", "title"],
                      },
                      page: {
                        type: "object",
                        properties: {
                          in: { const: "query" },
                          title: { const: "Page" },
                        },
                        required: ["in", "title"],
                      },
                    },
                    required: ["q", "page"],
                  },
                },
                required: ["q"],
              },
              Querystring: { type: "string" },
              Querynumber: { type: "number" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/search"].get.parameters).toEqual([
      {
        name: "q",
        in: "query",
        required: true,
        schema: { type: "string", title: "Keyword" },
      },
      {
        name: "page",
        in: "query",
        required: false,
        schema: { type: "number", title: "Page" },
      },
    ]);
  });

  it("resolves $ref in __params entries", () => {
    const route = api(
      { method: "GET", path: "/items/:id", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: { $ref: "#/components/schemas/Params" },
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  id: { $ref: "#/components/schemas/Pathnumber" },
                  __params: {
                    type: "object",
                    properties: {
                      id: {
                        $ref: "#/components/schemas/readonlyinpathreadonlytitleItemID",
                      },
                    },
                    required: ["id"],
                  },
                },
                required: ["id"],
              },
              Pathnumber: { type: "number" },
              readonlyinpathreadonlytitleItemID: {
                type: "object",
                properties: {
                  in: { const: "path", readOnly: true },
                  title: { const: "Item ID" },
                },
                required: ["in", "title"],
              },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/items/{id}"].get.parameters).toEqual([
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "number", title: "Item ID" },
      },
    ]);
  });

  it("includes the top-level OpenAPI document structure", () => {
    const route = api(
      { method: "GET", path: "/health", expose: true },
      async () => ({ ok: true }),
    );

    const document = openapi({
      info: {
        title: "Top Level Test",
        version: "1.2.3",
        description: "OpenAPI document",
      },
      routes: [route],
    });

    expect(document.openapi).toBe("3.1.0");
    expect(document.info).toEqual({
      title: "Top Level Test",
      version: "1.2.3",
      description: "OpenAPI document",
    });
    expect(document.components.schemas).toEqual({});
  });

  it("includes servers only when configured", () => {
    const servers = [
      { url: "https://api.example.com", description: "Production" },
      { url: "https://staging.example.com" },
    ];

    const withServers = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [],
      servers,
    });
    const withoutServers = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [],
    });

    expect(withServers.servers).toEqual(servers);
    expect(withoutServers).not.toHaveProperty("servers");
  });

  it("returns an empty paths object when routes are empty", () => {
    const document = openapi({
      info: { title: "Empty", version: "1.0.0" },
      routes: [],
    });

    expect(document.paths).toEqual({});
  });

  it("groups different methods under the same path", () => {
    const getRoute = api(
      { method: "GET", path: "/orders", expose: true },
      async () => ({ ok: true }),
    );
    const postRoute = api(
      { method: "POST", path: "/orders", expose: true },
      async () => ({ ok: true }),
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [getRoute, postRoute],
    });

    expect(document.paths["/orders"]).toEqual({
      get: {
        parameters: [],
        responses: {
          200: {
            description: "",
          },
        },
      },
      post: {
        parameters: [],
        responses: {
          200: {
            description: "",
          },
        },
      },
    });
  });

  it("skips routes when expose is undefined", () => {
    const route = api(
      { method: "GET", path: "/private" },
      async () => ({ ok: true }),
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths).toEqual({});
  });

  it("generates multiple path parameters from the route path", () => {
    const route = api(
      { method: "GET", path: "/api/:version/users/:id", expose: true },
      async () => ({ ok: true }),
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/api/{version}/users/{id}"].get.parameters).toEqual([
      {
        name: "version",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ]);
  });

  it("infers parameter locations from ref name prefixes without __params", () => {
    const route = api(
      { method: "GET", path: "/users/:id", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: { $ref: "#/components/schemas/Params" },
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  id: { $ref: "#/components/schemas/Pathstring" },
                  keyword: { $ref: "#/components/schemas/Querystring" },
                  authorization: {
                    $ref: "#/components/schemas/Headerstring",
                  },
                },
                required: ["id", "keyword"],
              },
              Pathstring: { type: "string" },
              Querystring: { type: "string" },
              Headerstring: { type: "string" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/users/{id}"].get.parameters).toEqual([
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "keyword",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "authorization",
        in: "header",
        required: false,
        schema: { type: "string" },
      },
    ]);
  });

  it("uses __entries parameter definitions directly", () => {
    const route = api(
      { method: "GET", path: "/reports/:id", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          __entries: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "include",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/reports/{id}"].get.parameters).toEqual([
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "include",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
    ]);
  });

  it("merges middleware parameter metadata without overriding route parameters", () => {
    const auth = middleware((next) => next, {
      parameters: {
        __entries: [
          {
            name: "request-id",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "include",
            in: "query",
            required: false,
            schema: { type: "boolean" },
          },
        ],
        __body: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  token: { type: "string" },
                },
                required: ["token"],
              },
            },
          },
        },
      },
    });

    const route = api(
      {
        method: "POST",
        path: "/reports/:id",
        expose: true,
        middlewares: [auth],
      },
      async () => ({ ok: true }),
      {
        parameters: {
          __entries: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "include",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/reports/{id}"].post.parameters).toEqual([
      {
        name: "request-id",
        in: "header",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "include",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
    ]);
    expect(document.paths["/reports/{id}"].post.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              token: { type: "string" },
            },
            required: ["token"],
          },
        },
      },
    });
  });

  it("prefers route requestBody over middleware requestBody", () => {
    const auth = middleware((next) => next, {
      parameters: {
        __entries: [],
        __body: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  token: { type: "string" },
                },
              },
            },
          },
        },
      },
    });

    const route = api(
      {
        method: "POST",
        path: "/reports",
        expose: true,
        middlewares: [auth],
      },
      async () => ({ ok: true }),
      {
        parameters: {
          __entries: [],
          __body: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                  },
                  required: ["name"],
                },
              },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/reports"].post.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
    });
  });

  it("merges middleware responses and lets route responses override by status", () => {
    const auth = middleware((next) => next, {
      responses: {
        __responses: [
          {
            status: 401,
            headers: {},
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        ],
      },
    });

    const rateLimit = middleware((next) => next, {
      responses: {
        __responses: [
          {
            status: 429,
            headers: {},
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        ],
      },
    });

    const route = api(
      {
        method: "GET",
        path: "/protected",
        expose: true,
        middlewares: [auth, rateLimit],
      },
      async () => ({ ok: true }),
      {
        responses: {
          __responses: [
            {
              status: 200,
              headers: {},
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                },
                required: ["ok"],
              },
            },
            {
              status: 429,
              headers: {},
              schema: {
                type: "object",
                properties: {
                  code: { type: "string" },
                },
                required: ["code"],
              },
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/protected"].get.responses).toEqual({
      200: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
              },
              required: ["ok"],
            },
          },
        },
      },
      401: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        },
      },
      429: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                code: { type: "string" },
              },
              required: ["code"],
            },
          },
        },
      },
    });
  });

  it("falls back to a default 200 response when schemas are missing", () => {
    const withoutResponses = api(
      { method: "GET", path: "/default-response", expose: true },
      async () => ({ ok: true }),
    );
    const withEmptyResponses = api(
      { method: "GET", path: "/empty-response", expose: true },
      async () => ({ ok: true }),
      {
        responses: {},
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [withoutResponses, withEmptyResponses],
    });

    expect(document.paths["/default-response"].get.responses).toEqual({
      200: {
        description: "",
      },
    });
    expect(document.paths["/empty-response"].get.responses).toEqual({
      200: {
        description: "",
      },
    });
  });

  it("strips __response from allOf responses and unwraps a single schema", () => {
    const route = api(
      { method: "POST", path: "/all-of", expose: true },
      async () => ({ ok: true }),
      {
        responses: {
          schemas: [
            {
              allOf: [
                {
                  type: "object",
                  properties: {
                    id: { type: "number" },
                    __response: {
                      type: "object",
                      properties: {
                        status: { const: 202 },
                      },
                    },
                  },
                  required: ["id", "__response"],
                },
                {},
              ],
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/all-of"].post.responses).toEqual({
      202: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                id: { type: "number" },
              },
              required: ["id"],
            },
          },
        },
      },
    });
  });

  it("omits content for __responses entries with an empty schema", () => {
    const route = api(
      { method: "DELETE", path: "/products/:id", expose: true },
      async () => ({ ok: true }),
      {
        responses: {
          __responses: [
            {
              status: 204,
              headers: {},
              schema: {},
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/products/{id}"].delete.responses).toEqual({
      204: {
        description: "",
      },
    });
  });

  it("skips non-string header values in __responses entries", () => {
    const route = api(
      { method: "GET", path: "/header-values", expose: true },
      async () => ({ ok: true }),
      {
        responses: {
          __responses: [
            {
              status: 200,
              headers: {
                "x-request-id": "req_123",
                "x-retry-after": 10,
                "x-extra": { value: "ignored" },
              },
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                },
                required: ["ok"],
              },
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/header-values"].get.responses["200"].headers).toEqual(
      {
        "x-request-id": {
          schema: { type: "string", const: "req_123" },
        },
      },
    );
  });

  it("supports mixed body and non-body parameters", () => {
    const route = api(
      { method: "POST", path: "/products/search", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: { $ref: "#/components/schemas/Params" },
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  q: { $ref: "#/components/schemas/Querystring" },
                  name: { $ref: "#/components/schemas/Jsonstring" },
                  price: { $ref: "#/components/schemas/Jsonnumber" },
                },
                required: ["q", "name"],
              },
              Querystring: { type: "string" },
              Jsonstring: { type: "string" },
              Jsonnumber: { type: "number" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    const op = document.paths["/products/search"].post;
    expect(op.parameters).toEqual([
      {
        name: "q",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
    ]);
    expect(op.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              price: { type: "number" },
            },
            required: ["name"],
          },
        },
      },
    });
  });

  it("falls back to path parameters when parameter components are missing", () => {
    const route = api(
      { method: "GET", path: "/orders/:id", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: {
            type: "object",
            properties: {
              id: { type: "number" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/orders/{id}"].get.parameters).toEqual([
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ]);
  });

  it("falls back to property descriptions when __params metadata omits them", () => {
    const route = api(
      { method: "GET", path: "/search", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schema: { $ref: "#/components/schemas/Params" },
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  q: {
                    $ref: "#/components/schemas/Querystring",
                    description: "Search keyword",
                  },
                  __params: {
                    type: "object",
                    properties: {
                      q: {
                        type: "object",
                        properties: {
                          in: { const: "query" },
                          title: { const: "Keyword" },
                        },
                        required: ["in", "title"],
                      },
                    },
                    required: ["q"],
                  },
                },
                required: ["q"],
              },
              Querystring: { type: "string" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/search"].get.parameters).toEqual([
      {
        name: "q",
        in: "query",
        required: true,
        schema: { type: "string", title: "Keyword" },
        description: "Search keyword",
      },
    ]);
  });

  it("resolves parameter roots from the schemas array", () => {
    const route = api(
      { method: "GET", path: "/schema-array", expose: true },
      async () => ({ ok: true }),
      {
        parameters: {
          version: "3.1",
          schemas: [{ $ref: "#/components/schemas/Params" }],
          components: {
            schemas: {
              Params: {
                type: "object",
                properties: {
                  page: { $ref: "#/components/schemas/Querynumber" },
                },
                required: ["page"],
              },
              Querynumber: { type: "number" },
            },
          },
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/schema-array"].get.parameters).toEqual([
      {
        name: "page",
        in: "query",
        required: true,
        schema: { type: "number" },
      },
    ]);
  });

  it("collects parameter metadata from inject", () => {
    const myInject = inject(async () => "token", {
      parameters: {
        __entries: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "include",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
      },
    });

    const route = api(
      { method: "GET", path: "/protected", expose: true },
      async () => ({ ok: true }),
      { inject: { myInject } },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/protected"].get.parameters).toEqual([
      {
        name: "Authorization",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "include",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
    ]);
  });

  it("collects response metadata from inject", () => {
    const myInject = inject(async () => "token", {
      responses: {
        __responses: [
          {
            status: 401,
            headers: {},
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        ],
      },
    });

    const route = api(
      { method: "GET", path: "/protected", expose: true },
      async () => ({ ok: true }),
      { inject: { myInject } },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/protected"].get.responses).toEqual({
      200: {
        description: "",
      },
      401: {
        description: "",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        },
      },
    });
  });

  it("inject parameters merge between middleware and route parameters", () => {
    const auth = middleware((next) => next, {
      parameters: {
        __entries: [
          {
            name: "request-id",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
        ],
      },
    });

    const myInject = inject(async () => "context", {
      parameters: {
        __entries: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "include",
            in: "query",
            required: false,
            schema: { type: "boolean" },
          },
        ],
      },
    });

    const route = api(
      {
        method: "GET",
        path: "/reports/:id",
        expose: true,
        middlewares: [auth],
      },
      async () => ({ ok: true }),
      {
        inject: { myInject },
        parameters: {
          __entries: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "number" },
            },
          ],
        },
      },
    );

    const document = openapi({
      info: { title: "Test", version: "1.0.0" },
      routes: [route],
    });

    expect(document.paths["/reports/{id}"].get.parameters).toEqual([
      {
        name: "request-id",
        in: "header",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "include",
        in: "query",
        required: false,
        schema: { type: "boolean" },
      },
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "number" },
      },
    ]);
  });
});
