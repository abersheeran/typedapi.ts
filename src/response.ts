import type { JsonResponse } from "./types.js";

declare const Bun:
  | {
      file(path: string): Blob & { exists(): Promise<boolean> };
    }
  | undefined;

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".gz": "application/gzip",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tar": "application/x-tar",
  ".txt": "text/plain",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

export type HeaderValues = Record<string, string | string[]>;

function withHeaders(
  headers: HeaderValues | undefined,
  required: Record<string, string>,
): Headers {
  const h = new Headers();

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          h.append(key, v);
        }
      } else {
        h.set(key, value);
      }
    }
  }

  for (const [key, value] of Object.entries(required)) {
    if (!h.has(key)) {
      h.set(key, value);
    }
  }

  return h;
}

function getMimeType(path: string): string {
  const lastDotIndex = path.lastIndexOf(".");
  const extension =
    lastDotIndex >= 0 ? path.slice(lastDotIndex).toLowerCase() : "";

  return MIME_TYPES[extension] ?? "application/octet-stream";
}

export function json<
  Body,
  Status extends number = 200,
  Headers extends HeaderValues = {},
>(
  body: Body,
  status?: Status,
  headers?: Headers,
): JsonResponse<Status, Headers, Body> {
  return new Response(JSON.stringify(body ?? null), {
    status: status ?? 200,
    headers: withHeaders(headers, {
      "content-type": "application/json; charset=utf-8",
    }),
  }) as unknown as JsonResponse<Status, Headers, Body>;
}

export function html(
  body: string,
  status = 200,
  headers?: HeaderValues,
): Response {
  return new Response(body, {
    status,
    headers: withHeaders(headers, {
      "content-type": "text/html; charset=utf-8",
    }),
  });
}

export function text(
  body: string,
  status = 200,
  headers?: HeaderValues,
): Response {
  return new Response(body, {
    status,
    headers: withHeaders(headers, {
      "content-type": "text/plain; charset=utf-8",
    }),
  });
}

export function redirect(url: string | URL, status = 307): Response {
  return new Response(null, {
    status,
    headers: {
      Location: typeof url === "string" ? url : url.href,
    },
  });
}

export function stream(
  body: ReadableStream,
  status = 200,
  headers?: HeaderValues,
): Response {
  return new Response(body, {
    status,
    headers: withHeaders(headers, {
      "content-type": "application/octet-stream",
    }),
  });
}

export async function file(
  path: string,
  options?: {
    status?: number;
    headers?: HeaderValues;
    contentType?: string;
  },
): Promise<Response> {
  const contentType = options?.contentType ?? getMimeType(path);
  const init = {
    status: options?.status ?? 200,
    headers: withHeaders(options?.headers, {
      "content-type": contentType,
    }),
  };

  if (typeof Bun !== "undefined") {
    const bunFile = Bun.file(path);

    if (!(await bunFile.exists())) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(bunFile, init);
  }

  try {
    const loadFs = new Function(
      'return import("node:fs/promises")',
    ) as () => Promise<{
      readFile(path: string): Promise<Uint8Array>;
    }>;
    const { readFile } = await loadFs();
    const data = await readFile(path);
    return new Response(new Uint8Array(data), init);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return new Response("Not Found", { status: 404 });
    }

    throw error;
  }
}

export function sse(
  body: ReadableStream | AsyncIterable<unknown>,
  headers?: HeaderValues,
): Response {
  return new Response(
    body instanceof ReadableStream ? body : asyncIterableToStream(body),
    {
      status: 200,
      headers: withHeaders(headers, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      }),
    },
  );
}

function asyncIterableToStream(source: AsyncIterable<unknown>): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const value of source) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
          );
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export interface CookieOptions {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  partitioned?: boolean;
}

export function cookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const segments = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
  ];

  if (options.domain) {
    segments.push(`Domain=${options.domain}`);
  }

  if (options.path) {
    segments.push(`Path=${options.path}`);
  }

  if (options.maxAge !== undefined) {
    segments.push(`Max-Age=${options.maxAge}`);
  }

  if (options.expires) {
    segments.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly) {
    segments.push("HttpOnly");
  }

  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure || options.sameSite === "None") {
    segments.push("Secure");
  }

  if (options.partitioned) {
    segments.push("Partitioned");
  }

  return segments.join("; ");
}

export function clearCookie(
  name: string,
  options: Omit<CookieOptions, "maxAge" | "expires"> = {},
): string {
  return cookie(name, "", {
    ...options,
    maxAge: 0,
    expires: new Date(0),
  });
}
