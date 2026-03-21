import { describe, it, expect } from "vitest";
import { api, handleError } from "../src/api.js";
import { HttpError } from "../src/error.js";
import { inject } from "../src/inject.js";
import { createRouter } from "../src/router.js";
import { routes } from "../src/routes.js";
import type { Middleware } from "../src/types.js";

function req(method: string, url: string) {
  return new Request(`http://localhost${url}`, { method });
}

// ── router 默认兜底 ──

describe("router default error handling", () => {
  it("HttpError with no body → status only", async () => {
    const app = createRouter([
      api({ method: "GET", path: "/forbidden" }, async () => {
        throw new HttpError(403);
      }),
    ]);
    const res = await app(req("GET", "/forbidden"));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("");
  });

  it("HttpError with string body → JSON { message }", async () => {
    const app = createRouter([
      api({ method: "GET", path: "/missing" }, async () => {
        throw new HttpError(404, "User not found");
      }),
    ]);
    const res = await app(req("GET", "/missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "User not found" });
  });

  it("HttpError with object body → JSON as-is", async () => {
    const app = createRouter([
      api({ method: "GET", path: "/invalid" }, async () => {
        throw new HttpError(422, { message: "Validation failed", errors: ["field required"] });
      }),
    ]);
    const res = await app(req("GET", "/invalid"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ message: "Validation failed", errors: ["field required"] });
  });

  it("HttpError with custom headers", async () => {
    const app = createRouter([
      api({ method: "GET", path: "/auth" }, async () => {
        throw new HttpError(401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
      }),
    ]);
    const res = await app(req("GET", "/auth"));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({ message: "Unauthorized" });
  });

  it("HttpError with headers and no body", async () => {
    const app = createRouter([
      api({ method: "GET", path: "/redir" }, async () => {
        throw new HttpError(302, undefined, { Location: "/login" });
      }),
    ]);
    const res = await app(req("GET", "/redir"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
    expect(await res.text()).toBe("");
  });

  it("plain Error → 500", async () => {
    const app = createRouter([
      api({ method: "GET", path: "/crash" }, async () => {
        throw new Error("database failed");
      }),
    ]);
    const res = await app(req("GET", "/crash"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal Server Error" });
  });

  it("non-Error throw → 500", async () => {
    const app = createRouter([
      api({ method: "GET", path: "/throw-string" }, async () => {
        throw "oops";
      }),
    ]);
    const res = await app(req("GET", "/throw-string"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal Server Error" });
  });

  it("middleware HttpError → controlled response", async () => {
    const auth: Middleware = (_next) => async () => {
      throw new HttpError(401, "Token expired");
    };
    const app = createRouter([
      api({ method: "GET", path: "/protected", middlewares: [auth] }, async () => ({ secret: 42 })),
    ]);
    const res = await app(req("GET", "/protected"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Token expired" });
  });

  it("middleware plain Error → 500", async () => {
    const broken: Middleware = (_next) => async () => {
      throw new Error("middleware broke");
    };
    const app = createRouter([
      api({ method: "GET", path: "/mw-crash", middlewares: [broken] }, async () => ({ ok: true })),
    ]);
    const res = await app(req("GET", "/mw-crash"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal Server Error" });
  });
});

// ── routes() onError 自定义 ──

describe("routes() custom onError", () => {
  class CustomError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  it("uses custom onError for custom error types", async () => {
    const apiRoutes = routes(
      {
        prefix: "/api",
        onError: (error) => {
          if (error instanceof CustomError) {
            return new Response(
              JSON.stringify({ code: error.code, message: error.message }),
              { status: 503, headers: { "content-type": "application/json" } },
            );
          }
          return new Response("Unknown", { status: 500 });
        },
      },
      api({ method: "GET", path: "/data" }, async () => {
        throw new CustomError("DB_FAIL", "connection lost");
      }),
    );
    const app = createRouter(apiRoutes);
    const res = await app(req("GET", "/api/data"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "DB_FAIL", message: "connection lost" });
  });

  it("custom onError also receives HttpError", async () => {
    const apiRoutes = routes(
      {
        onError: (error) => {
          if (error instanceof HttpError) {
            return new Response(
              JSON.stringify({ custom: true, status: error.status }),
              { status: error.status, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(null, { status: 500 });
        },
      },
      api({ method: "GET", path: "/err" }, async () => {
        throw new HttpError(404, "gone");
      }),
    );
    const app = createRouter(apiRoutes);
    const res = await app(req("GET", "/err"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ custom: true, status: 404 });
  });

  it("custom onError receives the request object", async () => {
    let receivedUrl = "";
    const apiRoutes = routes(
      {
        onError: (_error, request) => {
          receivedUrl = new URL(request.url).pathname;
          return new Response(null, { status: 500 });
        },
      },
      api({ method: "GET", path: "/with-req" }, async () => {
        throw new Error("fail");
      }),
    );
    const app = createRouter(apiRoutes);
    await app(req("GET", "/with-req"));
    expect(receivedUrl).toBe("/with-req");
  });

  it("routes without onError fall through to router default", async () => {
    const apiRoutes = routes(
      { prefix: "/api" },
      api({ method: "GET", path: "/boom" }, async () => {
        throw new HttpError(418, "teapot");
      }),
    );
    const app = createRouter(apiRoutes);
    const res = await app(req("GET", "/api/boom"));
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ message: "teapot" });
  });

  it("inject function error is caught by onError", async () => {
    const failingResource = inject(async () => {
      throw new Error("inject failed");
    });

    const apiRoutes = routes(
      {
        onError: (error) => {
          if (error instanceof Error) {
            return new Response(
              JSON.stringify({ source: "inject", message: error.message }),
              { status: 503, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(null, { status: 500 });
        },
      },
      api(
        { method: "GET", path: "/inject-err" },
        async () => ({ ok: true }),
        { inject: { resource: failingResource } },
      ),
    );
    const app = createRouter(apiRoutes);
    const res = await app(req("GET", "/inject-err"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ source: "inject", message: "inject failed" });
  });

  it("inject generator error cleans up earlier generators and is caught by onError", async () => {
    const events: string[] = [];
    const goodResource = inject(async function* () {
      events.push("good-start");
      yield "good";
      events.push("good-cleanup");
    });
    const badResource = inject(
      async function* () {
        throw new Error("bad inject");
        yield "never";
      },
      { cache: false },
    );

    const apiRoutes = routes(
      {
        onError: (error) => {
          if (error instanceof Error) {
            return new Response(
              JSON.stringify({ message: error.message }),
              { status: 503, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(null, { status: 500 });
        },
      },
      api(
        { method: "GET", path: "/partial" },
        async () => ({ ok: true }),
        { inject: { good: goodResource, bad: badResource } },
      ),
    );
    const app = createRouter(apiRoutes);
    const res = await app(req("GET", "/partial"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ message: "bad inject" });
    expect(events).toEqual(["good-start", "good-cleanup"]);
  });
});

// ── cleanup 在错误时仍然运行 ──

describe("cleanup runs on error", () => {
  it("injectable cleanup runs when handler throws HttpError", async () => {
    const events: string[] = [];
    const resource = inject(async function* () {
      events.push("start");
      yield "resource";
      events.push("cleanup");
    });

    const app = createRouter([
      api(
        { method: "GET", path: "/clean-http" },
        async () => {
          events.push("handler");
          throw new HttpError(400, "bad");
        },
        { inject: { resource } },
      ),
    ]);
    const res = await app(req("GET", "/clean-http"));
    expect(res.status).toBe(400);
    expect(events).toEqual(["start", "handler", "cleanup"]);
  });

  it("injectable cleanup runs when handler throws plain Error", async () => {
    const events: string[] = [];
    const resource = inject(async function* () {
      events.push("start");
      yield "resource";
      events.push("cleanup");
    });

    const app = createRouter([
      api(
        { method: "GET", path: "/clean-err" },
        async () => {
          events.push("handler");
          throw new Error("unexpected");
        },
        { inject: { resource } },
      ),
    ]);
    const res = await app(req("GET", "/clean-err"));
    expect(res.status).toBe(500);
    expect(events).toEqual(["start", "handler", "cleanup"]);
  });
});

// ── HttpError 类 ──

describe("HttpError class", () => {
  it("is instanceof Error", () => {
    expect(new HttpError(400)).toBeInstanceOf(Error);
  });

  it("is instanceof HttpError", () => {
    expect(new HttpError(400)).toBeInstanceOf(HttpError);
  });

  it("has correct message for string body", () => {
    const err = new HttpError(404, "Not found");
    expect(err.message).toBe("Not found");
    expect(err.status).toBe(404);
  });

  it("has default message for no body", () => {
    const err = new HttpError(403);
    expect(err.message).toBe("HTTP 403");
    expect(err.body).toBeUndefined();
  });
});

describe("handleError()", () => {
  it("returns 404 + { message } for HttpError with string body", async () => {
    const res = handleError(new HttpError(404, "Not found"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Not found" });
  });

  it("returns 403 + empty body for HttpError with no body", async () => {
    const res = handleError(new HttpError(403));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("");
  });

  it("returns object body as-is for HttpError", async () => {
    const body = { message: "Validation failed", errors: ["field"] };
    const res = handleError(new HttpError(422, body));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(body);
  });

  it("returns 500 for plain Error", async () => {
    const res = handleError(new Error("unexpected"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal Server Error" });
  });

  it("returns 500 for non-Error values", async () => {
    const res = handleError("string error");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal Server Error" });
  });
});
