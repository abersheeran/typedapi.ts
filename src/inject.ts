import type { HandlerContext } from "./context.js";

type InjectableGenerator<T> = AsyncGenerator<T, void, unknown>;
type InjectableParams = Record<string, unknown>;
type InjectableFn<T> =
  | ((params: InjectableParams, ctx: HandlerContext) => Promise<T>)
  | ((params: InjectableParams, ctx: HandlerContext) => InjectableGenerator<T>);

export const injectableParametersSymbol = Symbol("injectableParameters");
export const injectableResponsesSymbol = Symbol("injectableResponses");

export interface Injectable<T> {
  readonly __brand: "injectable";
  readonly fn: InjectableFn<T>;
  readonly cache: boolean;
  readonly inject?: Record<string, Injectable<any>>;
}

type InternalInjectable<T> = Injectable<T> & {
  [injectableParametersSymbol]?: unknown;
  [injectableResponsesSymbol]?: unknown;
};

type InjectableOptions = {
  cache?: boolean;
  inject?: Record<string, Injectable<any>>;
  parameters?: unknown;
  responses?: unknown;
};

export type Inject<I> = I extends Injectable<infer T>
  ? T & { readonly __inject?: true }
  : never;

export function inject<T>(
  fn: () => Promise<T>,
  options?: InjectableOptions,
): Injectable<T>;
export function inject<T>(
  fn: () => InjectableGenerator<T>,
  options?: InjectableOptions,
): Injectable<T>;
export function inject<T>(
  fn: (params: InjectableParams, ctx: HandlerContext) => Promise<T>,
  options?: InjectableOptions,
): Injectable<T>;
export function inject<T>(
  fn: (params: InjectableParams, ctx: HandlerContext) => InjectableGenerator<T>,
  options?: InjectableOptions,
): Injectable<T>;
export function inject<T>(
  fn: InjectableFn<T>,
  options: InjectableOptions = {},
): Injectable<T> {
  const injectable: InternalInjectable<T> = {
    __brand: "injectable" as const,
    fn,
    cache: options.cache ?? true,
    ...(options.inject !== undefined ? { inject: options.inject } : {}),
  };

  if (options.parameters !== undefined) {
    injectable[injectableParametersSymbol] = options.parameters;
  }

  if (options.responses !== undefined) {
    injectable[injectableResponsesSymbol] = options.responses;
  }

  return Object.freeze(injectable);
}

type ResolvedValues<T extends Record<string, Injectable<any>>> = {
  [K in keyof T]: Inject<T[K]>;
};

export async function resolveInjectables<T extends Record<string, Injectable<any>>>(
  injectables: T,
  params: InjectableParams,
  ctx: HandlerContext,
): Promise<{
  values: ResolvedValues<T>;
  cleanup: () => Promise<void>;
}> {
  const cache = new Map<Injectable<any>, unknown>();
  const generators: InjectableGenerator<unknown>[] = [];
  const visiting = new Set<Injectable<any>>();

  const resolveOne = async (injectable: Injectable<any>): Promise<unknown> => {
    if (injectable.cache && cache.has(injectable)) {
      return cache.get(injectable);
    }

    if (visiting.has(injectable)) {
      throw new Error("Circular injectable dependency detected");
    }

    visiting.add(injectable);
    try {
      const depValues: InjectableParams = {};
      const dependencies = injectable.inject;

      if (dependencies) {
        for (const [depKey, depInjectable] of Object.entries(dependencies)) {
          depValues[depKey] = await resolveOne(depInjectable);
        }
      }

      const result = injectable.fn({ ...params, ...depValues }, ctx);
      let value: unknown;

      if (isAsyncGenerator(result)) {
        const step = await result.next();
        value = step.value;
        generators.push(result);
      } else {
        value = await result;
      }

      if (injectable.cache) {
        cache.set(injectable, value);
      }

      return value;
    } finally {
      visiting.delete(injectable);
    }
  };

  const cleanup = async () => {
    for (let index = generators.length - 1; index >= 0; index -= 1) {
      const generator = generators[index];
      if (!generator) {
        continue;
      }

      try {
        await generator.next();
      } catch {}
    }
  };

  const values = {} as ResolvedValues<T>;

  try {
    for (const [rawKey, injectable] of Object.entries(injectables) as Array<
      [keyof T, T[keyof T]]
    >) {
      values[rawKey] = (await resolveOne(injectable)) as ResolvedValues<T>[typeof rawKey];
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    values,
    cleanup,
  };
}

function isAsyncGenerator<T>(value: unknown): value is InjectableGenerator<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    next?: unknown;
    [Symbol.asyncIterator]?: unknown;
  };

  return (
    typeof candidate.next === "function" &&
    typeof candidate[Symbol.asyncIterator] === "function"
  );
}
