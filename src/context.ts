export const requestSymbol: unique symbol = Symbol("request");

export type RequestContext = Request & { readonly __request?: true };
