import type { Middleware } from "./types.js";

const defaultMethods = ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"];

export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export function cors(options: CorsOptions = {}): Middleware {
  const origin = options.origin ?? "*";
  const methods = options.methods ?? defaultMethods;

  return (next) => async (params) => {
    const requestOrigin = readString(params, "origin");
    const preflightMethod = readString(params, "access-control-request-method");
    const headers = new Headers();

    headers.set(
      "Access-Control-Allow-Origin",
      resolveAllowOrigin(origin, requestOrigin),
    );

    if (options.credentials) {
      headers.set("Access-Control-Allow-Credentials", "true");
    }

    if (options.exposeHeaders && options.exposeHeaders.length > 0) {
      headers.set(
        "Access-Control-Expose-Headers",
        options.exposeHeaders.join(", "),
      );
    }

    if (origin !== "*") {
      appendVary(headers, "Origin");
    }

    if (preflightMethod) {
      headers.set("Access-Control-Allow-Methods", methods.join(", "));

      if (options.allowHeaders && options.allowHeaders.length > 0) {
        headers.set(
          "Access-Control-Allow-Headers",
          options.allowHeaders.join(", "),
        );
      } else {
        const requestHeaders = readString(
          params,
          "access-control-request-headers",
        );

        if (requestHeaders) {
          headers.set("Access-Control-Allow-Headers", requestHeaders);
        }
      }

      if (options.maxAge !== undefined) {
        headers.set("Access-Control-Max-Age", String(options.maxAge));
      }

      return new Response(null, { status: 204, headers });
    }

    const response = await next();
    const responseHeaders = new Headers(response.headers);

    headers.forEach((value, key) => {
      if (key.toLowerCase() === "vary") {
        appendVary(responseHeaders, value);
        return;
      }

      responseHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  };
}

function resolveAllowOrigin(
  origin: CorsOptions["origin"] | undefined,
  requestOrigin: string,
): string {
  if (typeof origin === "string") {
    return origin;
  }

  if (Array.isArray(origin)) {
    return origin.includes(requestOrigin) ? requestOrigin : "false";
  }

  if (typeof origin === "function") {
    return origin(requestOrigin) ? requestOrigin : "false";
  }

  return "*";
}

function readString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function appendVary(headers: Headers, value: string) {
  const current = headers.get("Vary");

  if (!current) {
    headers.set("Vary", value);
    return;
  }

  const entries = current
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (!entries.includes(value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}
