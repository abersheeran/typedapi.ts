import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const require = createRequire(import.meta.url);
const transform = require("../transform.cjs");
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function toImportPath(value: string) {
  const normalized = value.split(path.sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function compile(source: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "api-ts-transform-"));
  const entryPath = path.join(tempDir, "entry.ts");
  const outDir = path.join(tempDir, "dist");
  const importPath = toImportPath(
    path.relative(tempDir, path.join(repoRoot, "src/index.js")),
  );

  writeFileSync(entryPath, source.replaceAll("$IMPORT_PATH$", importPath));

  const outputs: Record<string, string> = {};
  const program = ts.createProgram([entryPath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    skipLibCheck: true,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    outDir,
  });
  const result = program.emit(
    undefined,
    (fileName, text) => {
      outputs[fileName] = text;
    },
    undefined,
    false,
    { before: [transform(program)] },
  );
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(result.diagnostics)
    .map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
  const output = Object.entries(outputs).find(([fileName]) =>
    fileName.endsWith("entry.js"),
  )?.[1];

  rmSync(tempDir, { recursive: true, force: true });

  if (result.emitSkipped || !output) {
    throw new Error(diagnostics.join("\n"));
  }

  return output;
}

describe("transform", () => {
  it("injects middleware parameters into the second argument", () => {
    const output = compile(`
      import { Header, middleware } from "$IMPORT_PATH$";

      middleware((next) =>
        async (params: {
          authorization: Header<string, { title: "Access Token" }>;
        }) => next(),
      );
    `);

    expect(output).toContain("parameters:");
    expect(output).toContain('authorization');
    expect(output).toContain('title: "Access Token"');
  });

  it("merges middleware parameters with an existing options object", () => {
    const output = compile(`
      import { Header, middleware } from "$IMPORT_PATH$";

      middleware(
        (next) =>
          async (params: {
            authorization: Header<string, { title: "Access Token" }>;
          }) => next(),
        { responses: { source: "auth-middleware" } },
      );
    `);

    expect(output).toContain('responses: { source: "auth-middleware" }');
    expect(output).toContain("parameters:");
  });

  it("injects middleware responses from the inner handler return type", () => {
    const output = compile(`
      import { JsonResponse, middleware } from "$IMPORT_PATH$";

      interface ErrorBody {
        message: string;
      }

      middleware((next) =>
        async (_params: {}): Promise<JsonResponse<401, {}, ErrorBody> | Response> =>
          next(),
      );
    `);

    expect(output).toContain("responses:");
    expect(output).toContain("status: 401");
    expect(output).toContain('message: {');
    expect(output).toContain('type: "string"');
    expect(output).not.toContain("parameters:");
  });

  it("skips Inject-branded params when generating OpenAPI parameters", () => {
    const output = compile(`
      import { Inject, Path, Query, api, inject } from "$IMPORT_PATH$";

      const dependency = inject(async function* (): AsyncGenerator<
        Query<string, { title: "Should Skip" }>
      > {
        yield "token" as Query<string, { title: "Should Skip" }>;
      });

      api(
        { method: "GET", path: "/users/:id" },
        async (params: {
          id: Path<number, { title: "User ID" }>;
          auth: Inject<typeof dependency>;
        }) => ({ id: params.id, auth: params.auth }),
      );
    `);

    expect(output).toContain("parameters:");
    expect(output).toContain('title: "User ID"');
    expect(output).not.toContain("Should Skip");
    expect(output).not.toContain('name: "auth"');
  });
});
