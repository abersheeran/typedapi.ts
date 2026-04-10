export type HandlerContext<T = unknown> = {
  request: Request;
  context: T;
};
