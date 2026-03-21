export class HttpError extends Error {
  readonly status: number;
  readonly body?: string | Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    body?: string | Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    super(typeof body === "string" ? body : `HTTP ${status}`);
    this.status = status;
    if (body !== undefined) this.body = body;
    if (headers !== undefined) this.headers = headers;
  }
}
