import { describe, it, expect } from "vitest";
import {
  clearCookie,
  cookie,
  html,
  json,
  redirect,
  sse,
  stream,
  text,
} from "../src/response.js";

function expectSetCookie(headers: Headers, values: string[]) {
  const getSetCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;

  if (typeof getSetCookie === "function") {
    expect(getSetCookie.call(headers)).toEqual(values);
    return;
  }

  const combined = headers.get("set-cookie");
  expect(combined).not.toBeNull();

  for (const value of values) {
    expect(combined).toContain(value);
  }
}

describe("json()", () => {
  it("returns application/json response", () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("supports custom status and headers", () => {
    const res = json({ ok: false }, 202, { "x-request-id": "req-1" });
    expect(res.status).toBe(202);
    expect(res.headers.get("x-request-id")).toBe("req-1");
  });

  it("allows overriding the default content-type", () => {
    const res = json({ ok: true }, 200, {
      "content-type": "application/problem+json",
    });
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("supports array header values", () => {
    const values = [
      cookie("session", "token-1", { path: "/", httpOnly: true }),
      cookie("refresh", "token-2", { path: "/", httpOnly: true }),
    ];
    const res = json({ ok: true }, 200, {
      "set-cookie": values,
    });

    expectSetCookie(res.headers, values);
  });

  it("serializes null for undefined body", async () => {
    const res = json(undefined);
    expect(await res.text()).toBe("null");
  });

  it("appends multi-value headers as comma-joined for non-set-cookie keys", () => {
    const res = json(
      { ok: true },
      200,
      { "cache-control": ["no-cache", "no-store"] },
    );

    expect(res.headers.get("cache-control")).toBe("no-cache, no-store");
  });
});

describe("html()", () => {
  it("returns text/html response", () => {
    const res = html("<h1>Hi</h1>");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("supports custom status", () => {
    const res = html("<h1>Not Found</h1>", 404);
    expect(res.status).toBe(404);
  });

  it("supports custom headers", () => {
    const res = html("<h1>Hi</h1>", 200, { "x-custom": "value" });
    expect(res.headers.get("x-custom")).toBe("value");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("supports array header values", () => {
    const values = [
      cookie("theme", "dark", { path: "/" }),
      cookie("locale", "ja", { path: "/" }),
    ];
    const res = html("<h1>Hi</h1>", 200, {
      "set-cookie": values,
    });

    expectSetCookie(res.headers, values);
  });

  it("body contains the HTML string", async () => {
    const res = html("<p>Test</p>");
    expect(await res.text()).toBe("<p>Test</p>");
  });

  it("supports empty string body", async () => {
    const res = html("");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("text()", () => {
  it("returns text/plain response", () => {
    const res = text("hello");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("supports custom status", () => {
    const res = text("error", 500);
    expect(res.status).toBe(500);
  });

  it("supports custom headers", () => {
    const res = text("hello", 200, { "x-custom": "value" });
    expect(res.headers.get("x-custom")).toBe("value");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("supports array header values", () => {
    const values = [
      cookie("theme", "dark", { path: "/" }),
      cookie("locale", "ja", { path: "/" }),
    ];
    const res = text("hello", 200, {
      "set-cookie": values,
    });

    expectSetCookie(res.headers, values);
  });

  it("body contains the string", async () => {
    const res = text("User-agent: *\nAllow: /");
    expect(await res.text()).toBe("User-agent: *\nAllow: /");
  });
});

describe("stream()", () => {
  it("returns application/octet-stream response", () => {
    const body = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const res = stream(body);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("supports custom headers", () => {
    const body = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const res = stream(body, 200, {
      "content-disposition": "attachment; filename=test.bin",
    });
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename=test.bin",
    );
  });

  it("supports array header values", () => {
    const values = [
      cookie("download", "1", { path: "/" }),
      cookie("source", "cdn", { path: "/" }),
    ];
    const body = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const res = stream(body, 200, {
      "set-cookie": values,
    });

    expectSetCookie(res.headers, values);
  });

  it("streams data correctly", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode("chunk1"));
        c.enqueue(encoder.encode("chunk2"));
        c.close();
      },
    });
    const res = stream(body);
    expect(await res.text()).toBe("chunk1chunk2");
  });
});

describe("sse()", () => {
  it("returns text/event-stream with correct headers", () => {
    const body = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const res = sse(body);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");
  });

  it("supports custom headers", () => {
    const body = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const res = sse(body, { "x-stream-name": "test" });
    expect(res.headers.get("x-stream-name")).toBe("test");
  });

  it("supports array header values", () => {
    const values = [
      cookie("channel", "events", { path: "/" }),
      cookie("retry", "enabled", { path: "/" }),
    ];
    const body = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const res = sse(body, {
      "set-cookie": values,
    });

    expectSetCookie(res.headers, values);
  });

  it("converts AsyncIterable to SSE format", async () => {
    async function* gen() {
      yield { a: 1 };
      yield { b: 2 };
    }
    const res = sse(gen());
    const body = await res.text();
    expect(body).toBe(
      'data: {"a":1}\n\ndata: {"b":2}\n\n',
    );
  });

  it("converts string yields to SSE format", async () => {
    async function* gen() {
      yield "hello";
      yield "world";
    }
    const res = sse(gen());
    const body = await res.text();
    expect(body).toBe('data: "hello"\n\ndata: "world"\n\n');
  });

  it("passes ReadableStream through unchanged", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode("data: manual\n\n"));
        c.close();
      },
    });
    const res = sse(body);
    expect(await res.text()).toBe("data: manual\n\n");
  });

  it("returns empty body for an empty async generator", async () => {
    async function* gen() {
      return;
    }
    const res = sse(gen());
    expect(await res.text()).toBe("");
  });

  it("JSON stringifies number yields", async () => {
    async function* gen() {
      yield 1;
      yield 2;
    }
    const res = sse(gen());
    expect(await res.text()).toBe("data: 1\n\ndata: 2\n\n");
  });
});

describe("cookie()", () => {
  it("serializes a basic cookie", () => {
    expect(cookie("session", "abc123")).toBe("session=abc123");
  });

  it("serializes all options", () => {
    expect(
      cookie("session", "abc123", {
        domain: ".example.com",
        path: "/app",
        maxAge: 3600,
        expires: new Date("2026-03-21T00:00:00.000Z"),
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        partitioned: true,
      }),
    ).toBe(
      "session=abc123; Domain=.example.com; Path=/app; Max-Age=3600; Expires=Sat, 21 Mar 2026 00:00:00 GMT; HttpOnly; SameSite=Lax; Secure; Partitioned",
    );
  });

  it("encodes cookie name and value", () => {
    expect(cookie("user name", "a=b c")).toBe("user%20name=a%3Db%20c");
  });

  it("adds secure when sameSite is None", () => {
    expect(cookie("session", "abc123", { sameSite: "None" })).toBe(
      "session=abc123; SameSite=None; Secure",
    );
  });
});

describe("clearCookie()", () => {
  it("serializes a cookie deletion value", () => {
    expect(clearCookie("session")).toBe(
      "session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });

  it("preserves path and domain options", () => {
    expect(
      clearCookie("session", {
        path: "/app",
        domain: ".example.com",
      }),
    ).toBe(
      "session=; Domain=.example.com; Path=/app; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });
});

describe("redirect()", () => {
  it("returns 307 and Location header by default for string input", async () => {
    const res = redirect("/login");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/login");
    expect(await res.text()).toBe("");
  });

  it("supports custom status", () => {
    const res = redirect("/moved", 301);

    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/moved");
  });

  it("supports URL input", () => {
    const url = new URL("https://example.com/path?x=1");
    const res = redirect(url);

    expect(res.headers.get("location")).toBe(url.href);
  });

  it("has a null body", () => {
    const res = redirect("/login");

    expect(res.body).toBeNull();
  });
});
