type InjectableGenerator<T> = AsyncGenerator<T, void, unknown>;
type InjectableParams = Record<string, unknown>;
type InjectableFn<T> =
  | ((params: InjectableParams) => Promise<T>)
  | ((params: InjectableParams) => InjectableGenerator<T>);

export const injectableParametersSymbol = Symbol("injectableParameters");
export const injectableResponsesSymbol = Symbol("injectableResponses");

export interface Injectable<T> {
  readonly __brand: "injectable";
  readonly fn: InjectableFn<T>;
  readonly cache: boolean;
}

type InternalInjectable<T> = Injectable<T> & {
  [injectableParametersSymbol]?: unknown;
  [injectableResponsesSymbol]?: unknown;
};

export type Inject<I> = I extends Injectable<infer T>
  ? T & { readonly __inject?: true }
  : never;

export function inject<T>(
  fn: () => Promise<T>,
  options?: { cache?: boolean; parameters?: unknown; responses?: unknown },
): Injectable<T>;
export function inject<T>(
  fn: () => InjectableGenerator<T>,
  options?: { cache?: boolean; parameters?: unknown; responses?: unknown },
): Injectable<T>;
export function inject<T>(
  fn: (params: InjectableParams) => Promise<T>,
  options?: { cache?: boolean; parameters?: unknown; responses?: unknown },
): Injectable<T>;
export function inject<T>(
  fn: (params: InjectableParams) => InjectableGenerator<T>,
  options?: { cache?: boolean; parameters?: unknown; responses?: unknown },
): Injectable<T>;
export function inject<T>(
  fn: InjectableFn<T>,
  options: { cache?: boolean; parameters?: unknown; responses?: unknown } = {},
): Injectable<T> {
  const injectable: InternalInjectable<T> = {
    __brand: "injectable" as const,
    fn,
    cache: options.cache ?? true,
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
  params?: InjectableParams,
): Promise<{
  values: ResolvedValues<T>;
  cleanup: () => Promise<void>;
}> {
  const values = {} as ResolvedValues<T>;
  const cache = new Map<Injectable<any>, unknown>();
  const generators: InjectableGenerator<unknown>[] = [];

  try {
    for (const [rawKey, injectable] of Object.entries(injectables) as Array<
      [keyof T, T[keyof T]]
    >) {
      const key = rawKey;

      if (injectable.cache && cache.has(injectable)) {
        values[key] = cache.get(injectable) as ResolvedValues<T>[typeof key];
        continue;
      }

      const result = injectable.fn(params ?? {});
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

      values[key] = value as ResolvedValues<T>[typeof key];
    }
  } catch (error) {
    for (let index = generators.length - 1; index >= 0; index -= 1) {
      const generator = generators[index];
      if (generator) {
        try {
          await generator.next();
        } catch {}
      }
    }
    throw error;
  }

  return {
    values,
    cleanup: async () => {
      for (let index = generators.length - 1; index >= 0; index -= 1) {
        const generator = generators[index];
        if (!generator) {
          continue;
        }

        try {
          await generator.next();
        } catch {}
      }
    },
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
