import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const sourceRoot = resolve(projectRoot, "src");
const contexts = ["memory", "retrieval", "evidence-agent", "benchmark"] as const;

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
}

function contextFor(path: string): typeof contexts[number] | undefined {
  const [first] = relative(sourceRoot, path).split(sep);
  return contexts.find((context) => context === first);
}

function importsFor(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return sourceFile.statements.flatMap((statement) => {
    if (
      (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [];
    }
    return [statement.moduleSpecifier.text];
  });
}

function importedContext(path: string, specifier: string): typeof contexts[number] | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolve(dirname(path), specifier.replace(/\.js$/u, ".ts"));
  return contextFor(target);
}

describe("architecture dependency rules", () => {
  it("keeps bounded-context dependencies pointing inward", async () => {
    const forbidden: Record<typeof contexts[number], ReadonlySet<string>> = {
      memory: new Set(["retrieval", "evidence-agent", "benchmark"]),
      retrieval: new Set(["evidence-agent", "benchmark"]),
      "evidence-agent": new Set(["benchmark"]),
      benchmark: new Set(),
    };
    const violations: string[] = [];

    for (const path of await listTypeScriptFiles(sourceRoot)) {
      const owner = contextFor(path);
      if (!owner) continue;
      const source = await readFile(path, "utf8");
      for (const specifier of importsFor(path, source)) {
        const dependency = importedContext(path, specifier);
        if (dependency && forbidden[owner].has(dependency)) {
          violations.push(
            `${relative(projectRoot, path)}: ${owner} -> ${dependency} (${specifier})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("routes cross-context imports through public context APIs", async () => {
    const violations: string[] = [];
    for (const path of await listTypeScriptFiles(sourceRoot)) {
      const owner = contextFor(path);
      if (!owner) continue;
      const source = await readFile(path, "utf8");
      for (const specifier of importsFor(path, source)) {
        const dependency = importedContext(path, specifier);
        if (
          dependency &&
          dependency !== owner &&
          !specifier.endsWith(`/${dependency}/index.js`)
        ) {
          violations.push(
            `${relative(projectRoot, path)}: ${owner} -> ${dependency} (${specifier})`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps context models independent of adapters and platform code", async () => {
    const violations: string[] = [];
    for (const path of await listTypeScriptFiles(sourceRoot)) {
      if (!relative(sourceRoot, path).split(sep).includes("model")) continue;
      const source = await readFile(path, "utf8");
      for (const specifier of importsFor(path, source)) {
        if (/\b(?:adapters|platform|entrypoints|composition)\b/u.test(specifier)) {
          violations.push(`${relative(projectRoot, path)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps context use cases independent of adapters and outer layers", async () => {
    const violations: string[] = [];
    for (const path of await listTypeScriptFiles(sourceRoot)) {
      const pathParts = relative(sourceRoot, path).split(sep);
      if (!contextFor(path) || !pathParts.includes("use-cases")) continue;
      const source = await readFile(path, "utf8");
      for (const specifier of importsFor(path, source)) {
        if (/(?:^|\/)(?:adapters|platform|composition)(?:\/|$)/u.test(specifier)) {
          violations.push(`${relative(projectRoot, path)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
